"use client";

import { StartTimeControl } from "./StartTimeControl";
import { retickTarget } from "./swap-undo";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { WRITE_LANDED_EVENT } from "@/components/RefreshWhenStale";
import { useSettings } from "@/components/settings/SettingsProvider";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { btnGhost } from "@/components/ui/styles";
import { api } from "@/lib/api-client";
import { downsampleRoute } from "@/lib/downsample";
import { adoptPrewarm, PREWARM_DELAY_MS, startPrewarm, type Prewarm } from "@/lib/suggestion-prewarm";
import { loadSuggestions, removeSuggestions, saveSuggestions } from "@/lib/suggestions-store";
import { prefetchPlacePhotos } from "@/lib/place-photo-cache";
import { useSuggestionWeather } from "@/lib/use-weather";
import { useHikes } from "@/lib/use-hike";
import { holdWeather } from "@/lib/weather-cache";
import { loadPopularityInBatches, POPULARITY_BATCH, rankSuggestions } from "@/lib/suggestion-popularity";
import { clampToSolarDay, computeArrivals, computeBestTimes, formatClock } from "@/lib/best-time";
import { useMounted } from "@/lib/use-mounted";
import { fromTimeValue, toTimeValue } from "./StartTimeControl";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { useOfflineCopy, type Freshness } from "@/lib/use-offline-copy";
import { isExactOptimization } from "@/lib/optimize-schedule";
import { leadingVisited, pinVisitedFirst } from "@/lib/visited-run";
import { routeSignature } from "@/lib/route-signature";
import { defaultLightPref } from "@/lib/light-windows";
import { formatDistance, formatDuration } from "@/lib/format";
import { coordsLabel, haversineMeters } from "@/lib/geo";
import { getSkyInfo } from "@/lib/sky";
import type { LightPref, LngLat, Place, RouteResult, Stop, StopSource, Suggestion, Trip, TripWithStops } from "@/lib/types";
import { MAX_ROUTE_WAYPOINTS, MAX_STOP_NAME, type StopPatch, type TripPatch } from "@/lib/validation";
import { MapView } from "./MapView";
import { focusLost } from "@/lib/focus";
import { PlaceCard } from "./PlaceCard";
import { SearchBar } from "./SearchBar";
import { StopCard } from "./StopCard";
import { StopDrawer } from "./StopDrawer";
import { StopList } from "./StopList";
import { TripPlan } from "./TripPlan";
import { TripPlanList } from "./TripPlanList";
import { StopsPanel } from "./StopsPanel";
import { SuggestionsPanel, type SuggestionsStatus } from "./SuggestionsPanel";
import { TripHeader } from "./TripHeader";

/** Hide suggestions that sit on top of an existing stop. */
const ALREADY_A_STOP_M = 100;
/** A lone stop within this distance of an earlier search point is already covered by that search's suggestions. */
const SAME_AREA_M = 15_000;
/** Alternatives for a stop are local: a tighter circle than the first-stop suggestions, and a short list. */
const ALTERNATIVES_RADIUS_KM = 10;
const MAX_ALTERNATIVES = 8;

type LatLng = { lat: number; lng: number };
/** A place being considered: a search result, a clicked spot, or a suggestion. */
type Pending = LatLng & { name: string; source: StopSource; osmId?: string; lightPref?: LightPref; resolving: boolean };

const NO_SUGGESTIONS: Suggestion[] = [];
const errorMessage = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** Sentences joined by ". ", without doubling a full stop that one of them already ends with; the last one keeps its own. */
function joinNotes(parts: (string | null)[]): string {
  const kept = parts.filter((t): t is string => !!t);
  return kept.map((t, i) => (i < kept.length - 1 ? t.replace(/\.$/, "") : t.replace(/\.?$/, "."))).join(". ");
}

/** The message api-client gives when a request fails because the browser is offline or the server is unreachable. */
const OFFLINE_ERROR = /offline or the server can't be reached/;
const OPTIMIZED_ANNOUNCEMENT = "Route optimized. Undo is available.";

/** JSON with sorted keys, so two copies of the same data compare equal whatever order their keys were built in. */
function canon(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val) ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : val,
  );
}

/** True when both are the same moment (or both absent), whatever their ISO spelling. */
function sameInstant(a: string | null, b: string | null): boolean {
  return a === b || (a !== null && b !== null && Date.parse(a) === Date.parse(b));
}

export function TripEditor({ initialTrip, userId }: { initialTrip: TripWithStops; /** Signed-in user; enables the offline copy. */ userId?: string }) {
  const { stops: initialStops, ...initialFields } = initialTrip;
  const { settings } = useSettings();
  const { confirm, dialog } = useConfirm();
  const [trip, setTrip] = useState<Trip>(initialFields);
  const [stops, setStops] = useState<Stop[]>(initialStops);
  // --- Keeping local state and the server in step -----------------------------
  // Writes in flight and a counter that moves when one starts or ends. A fresher copy of the trip from the server
  // (the page refreshed itself after Back/Forward, a stale tab refetching) is merged into the live state only when no
  // write overlapped the request that fetched it: otherwise it may predate that write and would undo it.
  const writesRef = useRef(0);
  const epochRef = useRef(0);
  const staleRef = useRef(false);
  const aliveRef = useRef(true);
  const [idleTick, setIdleTick] = useState(0);
  const latestRef = useRef({ trip, stops });
  const adoptRef = useRef<(server: TripWithStops, epoch: number) => boolean>(() => false);
  const refetchRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  /** Runs a server write, counting it as in flight. A write that lands after the editor was left tells the list page to reload. */
  async function tracked<T>(fn: () => Promise<T>): Promise<T> {
    writesRef.current += 1;
    epochRef.current += 1;
    try {
      return await fn();
    } finally {
      writesRef.current -= 1;
      epochRef.current += 1;
      if (writesRef.current === 0) {
        if (aliveRef.current) setIdleTick((n) => n + 1);
        else window.dispatchEvent(new Event(WRITE_LANDED_EVENT));
      }
    }
  }
  /** The server said this tab's view is out of date (409, or a stop that is gone): fetch the trip again once nothing is in flight. */
  function markStale() {
    staleRef.current = true;
    setIdleTick((n) => n + 1);
  }
  const markStaleOn = (e: unknown) => {
    const status = (e as { status?: unknown }).status;
    if (status === 404 || status === 409) markStale();
  };
  function adopt(server: TripWithStops, epoch: number): boolean {
    if (writesRef.current > 0 || epochRef.current !== epoch) return false;
    const { stops: serverStops, ...fields } = server;
    const sorted = [...serverStops].sort((a, b) => a.order - b.order);
    if (canon([fields, sorted]) !== canon([latestRef.current.trip, latestRef.current.stops])) {
      setTrip(fields);
      setStops(sorted);
    }
    return true;
  }
  async function refetchTrip() {
    const epoch = epochRef.current;
    try {
      const { trip: server } = await api.getTrip(trip.id);
      if (!adopt(server, epoch)) markStale(); // a write overlapped: ask again when it is done
    } catch {
      /* offline, or the trip is gone: the earlier error message stands */
    }
  }
  useEffect(() => {
    latestRef.current = { trip, stops };
    adoptRef.current = adopt;
    refetchRef.current = refetchTrip;
  });
  useEffect(() => {
    if (!staleRef.current || writesRef.current > 0) return;
    staleRef.current = false;
    void refetchRef.current();
  }, [idleTick]);
  // The page refreshed itself (Back/Forward showed a cached copy first): merge the fresh data instead of remounting, so typed
  // text, an open Edit trip form and requests in flight survive. It was requested when this editor opened (epoch 0).
  const incomingKey = useMemo(() => canon([initialFields, initialStops]), [initialTrip]); // eslint-disable-line react-hooks/exhaustive-deps
  const handledIncomingRef = useRef(incomingKey);
  useEffect(() => {
    if (handledIncomingRef.current === incomingKey) return;
    handledIncomingRef.current = incomingKey;
    if (!adoptRef.current(initialTrip, 0)) markStale();
  });
  /** Before an offline copy is stored: is what this tab shows what the server has? */
  async function verifyCopy(): Promise<Freshness> {
    if (writesRef.current > 0) return "unknown";
    const epoch = epochRef.current;
    try {
      const { trip: server } = await api.getTrip(trip.id);
      if (writesRef.current > 0 || epochRef.current !== epoch) return "unknown";
      const { stops: serverStops, ...fields } = server;
      if (canon([fields, serverStops]) === canon([trip, stops])) return "fresh";
      adopt(server, epoch); // this tab is behind: catch up (the copy is then saved from the new state)
      return "stale";
    } catch (e) {
      return (e as { status?: unknown }).status === 404 ? "gone" : "unknown";
    }
  }
  useOfflineCopy(trip, stops, userId, undefined, verifyCopy);
  // The outcome of the last route fetch, tagged with the waypoints it was for so a
  // stale result is never shown for different stops.
  const [routeResult, setRouteResult] = useState<{ key: string; route: RouteResult | null; error: string | null; dismissed: boolean } | null>(null);
  const [stopsError, setStopsError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  // Screen-reader announcements for results that otherwise only change the map (a stop added, a place picked, Optimize/Undo done).
  const [announcement, setAnnouncement] = useState("");
  const [adding, setAdding] = useState(false);
  const [cardId, setCardId] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<(LatLng & { nonce: number; area?: { bbox?: [number, number, number, number] } }) | null>(null);
  // Tagged with the waypoints they were found for, like routeResult: a change of stops
  // makes them stale, so they are simply not shown (and a late response is dropped).
  const [suggestionsState, setSuggestionsState] = useState<{ key: string; items: Suggestion[]; status: SuggestionsStatus; error: string | null; shown?: number; /** Read back from sessionStorage after a reload: popularity was already ranked, so it is not asked for again. */ restored?: boolean } | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  /** Counts up with each successful Optimize; on a new value the map zooms out to every stop and runs the water-flow animation. */
  const [routeFlowId, setRouteFlowId] = useState(0);
  const [undoing, setUndoing] = useState(false);
  // Remembered so the optimization can be undone. Only honoured while the list still
  // matches `appliedIds`, so any later add/remove/reorder retires it without bookkeeping.
  const [undo, setUndo] = useState<{
    previousIds: string[];
    appliedIds: string[];
    previousDepartAt: string | null;
    appliedDepartAt: string | null;
    previousOptimizedFor: string | null;
  } | null>(null);
  // The start-time move is kept as an instant and written out at render, so it follows the time-format setting.
  const [optimizeNote, setOptimizeNote] = useState<{ moveAt: string | null; notes: (string | null)[]; idsKey: string } | null>(null);
  // Alternatives found for one stop, tagged with the stop and the waypoints they were found for (stale ones are not shown).
  const [alternativesState, setAlternativesState] = useState<{ stopId: string; key: string; items: Suggestion[]; status: SuggestionsStatus; error: string | null } | null>(null);
  const alternativesSeq = useRef(0);
  const suggestionsSeq = useRef(0);
  // The last swap, kept client-side so it can be undone once. Honoured only while the stop is still where the swap put it.
  const [swapNote, setSwapNote] = useState<{
    stopId: string;
    fromName: string;
    toName: string;
    previous: { name: string; lat: number; lng: number; source: StopSource; visited: boolean };
    /** What the swap wrote; Undo is offered only while the stop still matches all of it, so it cannot overwrite newer edits. */
    applied: LatLng & { name: string; visited: boolean; source: StopSource };
    lostPhoto: boolean;
    /** Later stops that were ticked visited and that the swap's visited:false unticked too; Undo ticks them again. */
    cascadedIds: string[];
  } | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const centerRef = useRef<LatLng | null>(null);
  // A closed or finished place/stop card takes its focused button with it; the search box (always there) gets keyboard focus instead.
  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearch = () => searchRef.current?.focus();
  const lookupSeq = useRef(0);
  const refocusAfterAddRef = useRef(false);
  const pendingRef = useRef<Pending | null>(null);
  // After a successful add the place card (with the focused Add stop button) is gone: if focus fell to the page, the search box gets it.
  // (Not if the user moved on while the add was in flight.)
  useEffect(() => {
    pendingRef.current = pending;
    if (!refocusAfterAddRef.current) return;
    refocusAfterAddRef.current = false;
    if (pending) return; // another place card opened meanwhile: leave focus with it
    if (focusLost()) focusSearch();
  }, [pending]);

  const handleCenter = useCallback((c: LatLng) => {
    centerRef.current = c;
  }, []);

  // A trip with no stops opens on the world view; its name ("LA", "Yosemite") says where it is, so look it up once per
  // name and frame that place. The map itself ignores this once the viewer has moved it, and any stop takes over.
  const nameLocatedRef = useRef<string | null>(null);
  const noStops = stops.length === 0;
  // A trip named after a park or landmark also gets it as its first stop, once per trip: the marker is kept (localStorage) so a
  // deleted auto stop, a rename or a reload never adds it again.
  const autoStopKey = `autoFirstStop:${trip.id}`;
  const stopCountRef = useRef(stops.length);
  const addStopRef = useRef<typeof addStop | null>(null);
  const optimizeRef = useRef<((opts?: { departAt: string | null }) => Promise<void>) | null>(null);
  /** The start-time save in flight, if any: Optimize waits for it so it plans from the time just typed. It resolves to the saved departAt (undefined if the save failed). */
  const startSaveRef = useRef<Promise<string | null | undefined> | null>(null);
  /** Set from the Optimize click until the run ends, so a second click (while waiting for the start-time save) is ignored. */
  const optimizeClickRef = useRef(false);
  const [optimizeWaiting, setOptimizeWaiting] = useState(false);
  // Adds in progress (a manual one may be mid-flight when the name lookup answers) and whether the first start was saved.
  const addsInFlightRef = useRef(0);
  const firstStartSavedRef = useRef(false);
  useEffect(() => {
    stopCountRef.current = stops.length;
    addStopRef.current = addStop;
    optimizeRef.current = optimizeRoute;
  });
  // Any stop (typed in by hand inside the 700 ms wait, say) settles the question for good: deleting it later must not
  // bring the landmark back as an auto stop, so write the marker as soon as the trip has a stop.
  useEffect(() => {
    if (noStops) return;
    nameLocatedRef.current = trip.name.trim();
    try { if (window.localStorage.getItem(autoStopKey) === null) window.localStorage.setItem(autoStopKey, "1"); } catch { /* storage unavailable */ }
  }, [noStops, autoStopKey, trip.name]);
  // A lookup that failed (offline, say) is tried again when the browser reports the connection is back.
  const [locateRetry, setLocateRetry] = useState(0);
  useEffect(() => {
    const retry = () => setLocateRetry((n) => n + 1);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);
  // The "offline or the server can't be reached" banner goes away when the browser reports the connection is back
  // (the next successful action clears an error banner too); the dismiss button works as before.
  // A route that failed to load is fetched again at the same moment (routeRetry is in the directions effect's deps).
  const [routeRetry, setRouteRetry] = useState(0);
  const routeFailedRef = useRef(false);
  useEffect(() => {
    routeFailedRef.current = routeResult !== null && routeResult.error !== null;
  });
  useEffect(() => {
    const clearOffline = () => {
      if (routeFailedRef.current) setRouteRetry((n) => n + 1);
      setStopsError((prev) => (prev !== null && OFFLINE_ERROR.test(prev) ? null : prev));
      setRouteResult((r) => (r && r.error !== null && OFFLINE_ERROR.test(r.error) ? { ...r, dismissed: true } : r));
    };
    window.addEventListener("online", clearOffline);
    return () => window.removeEventListener("online", clearOffline);
  }, []);
  useEffect(() => {
    const name = trip.name.trim();
    if (!noStops || name.length < 2 || nameLocatedRef.current === name) return;
    let live = true;
    const timer = setTimeout(() => {
      nameLocatedRef.current = name;
      api.locate(name).then(
        ({ area, landmark }) => {
          if (!live || !area) return;
          setFlyTo({ lat: area.lat, lng: area.lng, nonce: Date.now(), area: { bbox: area.bbox } });
          let done = false;
          try { done = window.localStorage.getItem(autoStopKey) !== null; } catch { /* storage unavailable: the in-memory guards still apply */ }
          // Only a park or landmark becomes a stop; a town, state or any other name just frames the map.
          if (done || !landmark || stopCountRef.current !== 0 || addsInFlightRef.current !== 0 || !addStopRef.current) return;
          try { window.localStorage.setItem(autoStopKey, "1"); } catch { /* ignore */ }
          // Same path as a manual add; the lone-stop suggestions search then starts by itself. Failures stay silent.
          void addStopRef.current({ name: landmark.name, lat: landmark.lat, lng: landmark.lng, source: "manual" }, true).then((added) => {
            if (added) return;
            try { window.localStorage.removeItem(autoStopKey); } catch { /* ignore */ }
          });
        },
        () => { nameLocatedRef.current = null; }, // a failed lookup may be retried; it never shows an error
      );
    }, 700);
    return () => { live = false; clearTimeout(timer); };
  }, [trip.name, noStops, autoStopKey, locateRetry]);

  // Route through the stops in order. A string key so edits that don't move anything
  // (visited, notes) don't refetch. Fewer than 2 stops means no route at all.
  const waypointKey = JSON.stringify(stops.map((s) => [s.lng, s.lat]));
  const waypointKeyRef = useRef(waypointKey);
  useEffect(() => {
    waypointKeyRef.current = waypointKey;
  }, [waypointKey]);
  const idsKey = stops.map((s) => s.id).join(",");
  const idsKeyRef = useRef(idsKey);
  useEffect(() => {
    idsKeyRef.current = idsKey;
  }, [idsKey]);
  // What the optimizer reads besides positions (including the trip date): a change to it mid-flight makes the result stale.
  const prefsKey = JSON.stringify([trip.plannedDate, stops.map((s) => [s.lightPref, s.priority, s.dwellMinutes])]);
  const prefsKeyRef = useRef(prefsKey);
  useEffect(() => {
    prefsKeyRef.current = prefsKey;
  }, [prefsKey]);
  // Generated suggestions stay on the page whatever happens to the stops (the tag only says which search made them);
  // a new search happens when the owner asks, or when a lone stop moves somewhere the list does not cover.
  const freshSuggestions = suggestionsState;
  const suggestionsStateRef = useRef(suggestionsState);
  useEffect(() => {
    suggestionsStateRef.current = suggestionsState;
  }, [suggestionsState]);
  // After a reload the finished list comes back from sessionStorage (read in an effect, not in the initial state, so the
  // server and first client render agree). This effect is declared before the single-stop search below, so that search sees
  // the restored list through the ref and does not fetch again. No network call is made here.
  const restoredRef = useRef<typeof suggestionsState>(null);
  useEffect(() => {
    if (suggestionsStateRef.current) return;
    const saved = loadSuggestions(trip.id);
    if (!saved) return;
    const restored = { key: saved.key, items: saved.items, status: "done" as const, error: null, restored: true };
    restoredRef.current = restored;
    suggestionsStateRef.current = restored;
    // Deliberate: reading storage must wait until after hydration (see above).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSuggestionsState(restored);
  }, [trip.id]);
  // Keep the saved copy in step with the list (a Dismiss or Accept saves again). Only a fully ranked list is saved (`shown` is
  // set while popularity is still revealing it), so a reload never freezes a half-ranked one. A search in flight leaves the saved copy
  // alone; one that failed but kept the old (complete) list on screen saves it again, so a Dismiss sticks; anything else clears it.
  useEffect(() => {
    if (!suggestionsState || suggestionsState === restoredRef.current) return;
    const { status, items, key, shown } = suggestionsState;
    if (status === "done") {
      if (shown === undefined) saveSuggestions(trip.id, { key, items });
      else removeSuggestions(trip.id);
    } else if (status === "error" && items.length > 0) saveSuggestions(trip.id, { key, items }); // the kept list is a complete one
    else if (status === "loading") return;
    else removeSuggestions(trip.id);
  }, [suggestionsState, trip.id]);
  // A place that is now a stop is not suggested again.
  const allSuggestions = useMemo(() => {
    const items = freshSuggestions?.items;
    if (!items) return NO_SUGGESTIONS;
    const kept = items.filter((x) => !stops.some((st) => haversineMeters(st, x) < ALREADY_A_STOP_M));
    return kept.length === items.length ? items : kept;
  }, [freshSuggestions?.items, stops]);
  // Only the first chunk is shown at first; the rest is revealed 5 at a time as popularity ranks it (undefined = all).
  const shownCount = freshSuggestions?.shown;
  const suggestions = useMemo(() => (shownCount === undefined ? allSuggestions : allSuggestions.slice(0, shownCount)), [allSuggestions, shownCount]);
  const suggestionsStatus: SuggestionsStatus = freshSuggestions?.status ?? (stops.length === 1 ? "loading" : "idle");
  const suggestionsError = freshSuggestions?.error ?? null;
  // Places show up as soon as they are found; popularity then fills in 10 at a time and re-ranks the list.
  const suggestionItemsRef = useRef<Suggestion[]>(NO_SUGGESTIONS);
  useEffect(() => {
    suggestionItemsRef.current = allSuggestions;
  }, [allSuggestions]);
  const popularityKey = freshSuggestions?.status === "done" && !freshSuggestions.restored ? freshSuggestions.key : null;
  useEffect(() => {
    if (popularityKey === null) return;
    return loadPopularityInBatches(
      suggestionItemsRef.current,
      (counts, notable) => {
        setSuggestionsState((prev) =>
          prev && prev.key === popularityKey
            ? {
                ...prev,
                items: rankSuggestions(
                  prev.items.map((s) => ({
                    ...s,
                    ...(counts.has(s.osmId) ? { popularity: counts.get(s.osmId) } : {}),
                    ...(notable.has(s.osmId) ? { notable: notable.get(s.osmId) } : {}),
                  })),
                ),
                shown: prev.shown === undefined ? undefined : prev.shown + POPULARITY_BATCH,
              }
            : prev,
        );
      },
      () => setSuggestionsState((prev) => (prev && prev.key === popularityKey ? { ...prev, shown: undefined } : prev)),
    );
  }, [popularityKey]);
  // Weather is fetched last: it waits while places are being found or ranked (status "loading", or "done" with popularity still revealing).
  const suggestionsBusy = suggestionsStatus === "loading" || (freshSuggestions?.status === "done" && freshSuggestions.shown !== undefined);
  useEffect(() => {
    if (!suggestionsBusy) return;
    return holdWeather();
  }, [suggestionsBusy]);
  const suggestionWeather = useSuggestionWeather(suggestions, trip.plannedDate, !suggestionsBusy);
  // As soon as places are found, fetch their photos in the background so popups and cards open with the picture ready.
  useEffect(() => {
    if (suggestions.length === 0) return;
    return prefetchPlacePhotos(suggestions.map((s) => ({ key: s.osmId, name: s.name, lat: s.lat, lng: s.lng })));
  }, [suggestions]);
  useEffect(() => {
    const coordinates = JSON.parse(waypointKey) as LngLat[];
    if (coordinates.length < 2) return;
    let cancelled = false;
    api.directions(coordinates).then(
      ({ route: next }) => {
        if (cancelled) return;
        setRouteResult({ key: waypointKey, route: next, error: null, dismissed: false });
      },
      (e: unknown) => {
        if (cancelled) return;
        setRouteResult({ key: waypointKey, route: null, error: errorMessage(e, "Couldn't load the route"), dismissed: false });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [waypointKey, routeRetry]);

  // With a single stop there is no route to follow, so look around that stop automatically
  // (with two or more, suggestions follow the route and are found on request).
  useEffect(() => {
    const coordinates = JSON.parse(waypointKey) as LngLat[];
    if (coordinates.length !== 1) return;
    const [lng, lat] = coordinates[0];
    // A finished list that already covers this stop stays; only a stop that moved out of its reach searches again.
    const have = suggestionsStateRef.current;
    if (have?.status === "done" && (JSON.parse(have.key) as LngLat[]).some(([x, y]) => haversineMeters({ lat, lng }, { lat: y, lng: x }) < SAME_AREA_M)) return;
    let cancelled = false;
    // This search replaces any the owner asked for along the route: a late answer from that one must not overwrite this list.
    const prevSeq = suggestionsSeq.current;
    const seq = ++suggestionsSeq.current;
    api.suggestions({ around: [lng, lat] }, { enrich: false }).then(
      ({ suggestions: found }) => {
        if (cancelled || seq !== suggestionsSeq.current) return;
        const items = found.filter((s) => haversineMeters({ lat, lng }, s) >= ALREADY_A_STOP_M);
        setSuggestionsState({ key: waypointKey, items, status: "done", error: null, shown: POPULARITY_BATCH });
      },
      (e: unknown) => {
        if (cancelled || seq !== suggestionsSeq.current) return;
        setSuggestionsState({ key: waypointKey, items: [], status: "error", error: errorMessage(e, "Couldn't load suggestions. Please retry.") });
      },
    );
    return () => {
      cancelled = true;
      // Cancelled before anyone replaced it: give the number back, so the search it displaced can still write (else "Searching…" sticks).
      if (suggestionsSeq.current === seq) suggestionsSeq.current = prevSeq;
    };
  }, [waypointKey]);

  const enoughForRoute = stops.length >= 2;
  const current = enoughForRoute && routeResult?.key === waypointKey ? routeResult : null;
  const activeRoute = current?.route ?? null;
  const activeRouteError = current?.error ?? null;
  // The unsaved Start time edit lives here so it survives a switch to another tab.
  const [startDraft, setStartDraft] = useState<string | null>(null);
  // Optimized only while the stored signature still matches the stops: any edit that matters turns it off by itself.
  const optimized = stops.length >= 2 && trip.routeOptimizedFor === routeSignature(trip.plannedDate, stops);
  const optimizeStale = !optimized && stops.length >= 2 && !!trip.routeOptimizedFor;
  // Once the route has been steady for a moment, fetch the place list quietly (popularity waits for the click), so
  // "Find photo spots" answers from what has already come in. Dropped when the stops change.
  const prewarmRef = useRef<{ key: string; prewarm: Prewarm } | null>(null);
  const askedKeyRef = useRef<string | null>(null); // the route "Find" last searched, so a pending prewarm does not repeat it
  useEffect(() => {
    if (!activeRoute) return;
    // A list restored after a reload is already on screen: no quiet place search behind it (Find searches afresh if asked).
    const shown = suggestionsStateRef.current;
    if (shown?.restored && shown.key === waypointKey) return;
    const geometry = activeRoute.geometry;
    let entry: { key: string; prewarm: Prewarm } | null = null;
    const timer = setTimeout(() => {
      if (askedKeyRef.current === waypointKey) return;
      entry = { key: waypointKey, prewarm: startPrewarm(async () => {
          const r = await api.suggestions(downsampleRoute(geometry), { enrich: false });
          if (r.degraded) throw new Error("incomplete"); // a stand-in, not the full answer: Find searches again
          return r.suggestions;
        }) };
      prewarmRef.current = entry;
    }, PREWARM_DELAY_MS);
    return () => {
      clearTimeout(timer);
      if (entry && prewarmRef.current === entry) prewarmRef.current = null;
    };
  }, [activeRoute, waypointKey]);
  const legDurations = activeRoute ? activeRoute.legs.map((l) => l.duration) : null;

  // With no saved start time the trip starts now (fixed when the editor opened), on the trip's day.
  const mounted = useMounted();
  const [openedAt] = useState(() => new Date().toISOString());
  const defaultDepartAt = useMemo(
    () => (mounted ? fromTimeValue(trip.plannedDate, toTimeValue(openedAt), stops[0]?.lng) : null),
    [mounted, trip.plannedDate, openedAt, stops[0]?.lng], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const departAt = trip.departAt ?? defaultDepartAt;

  const bestTimes = useMemo(
    () => computeBestTimes({ plannedDate: trip.plannedDate, departAt, stops }, legDurations),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- legDurations is derived from activeRoute
    [trip.plannedDate, departAt, stops, activeRoute],
  );
  const arrivals = useMemo(
    () => computeArrivals({ plannedDate: trip.plannedDate, departAt, stops }, legDurations),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- legDurations is derived from activeRoute
    [trip.plannedDate, departAt, stops, activeRoute],
  );

  async function saveTrip(patch: TripPatch) {
    await tracked(async () => {
      const { trip: updated } = await api.updateTrip(trip.id, patch);
      setTrip(updated);
    });
  }

  async function addStop(input: { name: string; lat: number; lng: number; source: StopSource; lightPref?: LightPref }, quiet = false) {
    return tracked(() => addStopInner(input, quiet));
  }

  async function addStopInner(input: { name: string; lat: number; lng: number; source: StopSource; lightPref?: LightPref }, quiet: boolean) {
    addsInFlightRef.current += 1;
    try {
      // Only a changed default is sent; otherwise the server's own default (30) applies, exactly as before.
      const dwell = settings.defaultDwellMinutes === DEFAULT_SETTINGS.defaultDwellMinutes ? {} : { dwellMinutes: settings.defaultDwellMinutes };
      // The server refuses a name over 200 characters (a long search result); shorten it here instead of failing the add.
      const name = input.name.length > MAX_STOP_NAME ? input.name.slice(0, MAX_STOP_NAME).trimEnd() : input.name;
      const { stop } = await api.addStop(trip.id, { ...dwell, ...input, name });
      setStops((prev) => [...prev, stop]);
      setStopsError(null);
      const count = stopCountRef.current + 1;
      setAnnouncement(`Added ${stop.name}. ${count} ${count === 1 ? "stop" : "stops"} in your trip.`);
      if (stops.length === 0 && trip.departAt === null && !firstStartSavedRef.current) {
        firstStartSavedRef.current = true;
        void saveFirstStart(stop.lng, quiet);
      }
      return stop;
    } catch (e) {
      if (!quiet) setStopsError(errorMessage(e, "Couldn't add the stop"));
      return null;
    } finally {
      addsInFlightRef.current -= 1;
    }
  }

  /**
   * A new trip is created without a start time (it has no stops, so no solar day yet). With its first stop the start is
   * saved as now on the planned day at that stop, so shared and offline views show the same start as this editor.
   */
  async function saveFirstStart(lng: number, quiet = false) {
    const now = new Date();
    const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const iso = fromTimeValue(trip.plannedDate, clock, lng);
    if (!iso) return;
    try {
      await saveTrip({ departAt: iso });
    } catch (e) {
      firstStartSavedRef.current = false;
      if (!quiet) setStopsError(errorMessage(e, "Couldn't save the start time"));
    }
  }

  // --- Picking a place -------------------------------------------------------

  /** Map click: show the pin immediately, then name it (falling back to coordinates). */
  async function pickPoint(p: LatLng) {
    const seq = ++lookupSeq.current;
    setCardId(null);
    setPending({ ...p, name: "Looking up place…", source: "manual", resolving: true });
    let name: string;
    try {
      name = (await api.reverseGeocode(p.lat, p.lng)).place.name;
    } catch {
      name = coordsLabel(p);
    }
    if (seq === lookupSeq.current) {
      setPending({ ...p, name, source: "manual", resolving: false });
      setAnnouncement(`Selected ${name}. Use Add stop to include it.`);
    }
  }

  function selectSearchResult(place: Place) {
    lookupSeq.current++; // cancel any in-flight click lookup
    setCardId(null);
    setPending({ lat: place.lat, lng: place.lng, name: place.name, source: "manual", resolving: false });
    setAnnouncement(`Selected ${place.name}. Use Add stop to include it.`);
    setFlyTo({ lat: place.lat, lng: place.lng, nonce: Date.now() });
  }

  function pickSuggestion(osmId: string) {
    const s = suggestions.find((x) => x.osmId === osmId);
    if (!s) return;
    lookupSeq.current++;
    setCardId(null);
    setPending({ lat: s.lat, lng: s.lng, name: s.name, source: "suggested", osmId: s.osmId, lightPref: defaultLightPref(s.kind, settings.suggestionLightPref), resolving: false });
    setAnnouncement(`Selected ${s.name}. Use Add stop to include it.`);
  }

  async function addPending() {
    if (!pending || pending.resolving) return;
    setAdding(true);
    const placed = await addStop({ name: pending.name, lat: pending.lat, lng: pending.lng, source: pending.source, lightPref: pending.lightPref });
    setAdding(false);
    if (!placed) return;
    if (pending.osmId) takeSuggestion(pending.osmId);
    // Only close the card we added from; the user may have opened another meanwhile.
    const added = pending;
    setPending((cur) => (cur === added ? null : cur));
    // The card unmounts on the next render, so the focus check waits for that (see the effect on `pending`).
    refocusAfterAddRef.current = pendingRef.current === null || pendingRef.current === added;
  }

  // --- Stops -----------------------------------------------------------------

  /** Apply an order-by-id map onto the latest state and re-sort by it, without
   *  touching any other field — safe against a concurrent mutation (e.g.
   *  toggling Visited) that lands on `stops` while a reorder is in flight. */
  function applyOrder(orderById: Map<string, number>) {
    setStops((cur) =>
      cur
        .map((s) => ({ ...s, order: orderById.get(s.id) ?? s.order }))
        .sort((a, b) => a.order - b.order),
    );
  }

  const reorderSeq = useRef(0);

  /** Resolves true when the new order was saved (false: reverted, error shown). */
  async function reorder(ids: string[], announce = false, movedId?: string): Promise<boolean> {
    return tracked(() => reorderInner(ids, announce, movedId));
  }

  async function reorderInner(requested: string[], announce: boolean, movedId?: string): Promise<boolean> {
    // Visited stops stay first, as the server also enforces; only the unvisited ones take the requested order.
    const ids = pinVisitedFirst(stops, requested);
    const seq = ++reorderSeq.current;
    const previousOrderById = new Map(stops.map((s) => [s.id, s.order]));
    // Applied onto the latest state so an edit that landed since this render is never reverted.
    applyOrder(new Map(ids.map((id, order) => [id, order])));
    try {
      const { stops: reordered } = await api.reorderStops(trip.id, ids);
      // A newer drag has been sent since: its answer decides the order, not this one.
      if (seq === reorderSeq.current) {
        applyOrder(new Map(reordered.map((s) => [s.id, s.order])));
        setStopsError(null);
        if (announce) announceMove(previousOrderById, ids, movedId);
      }
      return true;
    } catch (e) {
      markStaleOn(e);
      if (seq !== reorderSeq.current) return false; // superseded: do not revert over the newer order
      applyOrder(previousOrderById);
      setStopsError(errorMessage(e, "Couldn't save the new order"));
      return false;
    }
  }

  /** Says which stop moved where (a drag or keyboard reorder changes nothing else a screen reader would hear). */
  function announceMove(previous: Map<string, number>, ids: string[], movedId?: string) {
    const before = [...previous.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    let first = 0;
    while (first < ids.length && before[first] === ids[first]) first++;
    if (first >= ids.length) return;
    let last = ids.length - 1;
    while (last > first && before[last] === ids[last]) last--;
    // The stop the user moved is known from the drag; guessing from the order is ambiguous for a one-step move (two stops swap places).
    const moved = movedId && ids.includes(movedId) ? movedId : before[first] === ids[last] ? ids[last] : ids[first];
    const name = latestRef.current.stops.find((s) => s.id === moved)?.name ?? "Stop";
    setAnnouncement(`Moved ${name} to position ${ids.indexOf(moved) + 1} of ${ids.length}.`);
  }

  /** `opts.departAt` is a start time just saved that this render may not show yet; it is used instead of `trip.departAt`. */
  async function optimizeRoute(opts?: { departAt: string | null }) {
    if (optimizing || stops.length < 2) return;
    const startKey = idsKey;
    const startWaypoints = waypointKey;
    const startPrefs = prefsKey;
    const before = stops;
    const previousDepartAt = opts ? opts.departAt : trip.departAt;
    const previousOptimizedFor = trip.routeOptimizedFor ?? null;
    setOptimizing(true);
    setOptimizeNote(null);
    try {
      // Visited stops are behind the owner: they stay where they are, and the last of them is the fixed start of the re-plan.
      const done = leadingVisited(before);
      const anchor = Math.max(done - 1, 0);
      const head = before.slice(0, anchor);
      const tail = before.slice(anchor);
      // The re-plan starts at the last visited stop: when the current route says the owner got there. The optimizer adds that stop's dwell itself.
      const anchorArrival = done > 1 ? arrivals[anchor] : null;
      const planFrom = anchorArrival ? anchorArrival.toISOString() : (previousDepartAt ?? (done > 0 ? departAt : null));
      if (done >= before.length) {
        setOptimizeNote({ moveAt: null, notes: ["Every stop is already visited, so there is nothing left to reorder"], idsKey: startKey });
        return;
      }
      // Two stops have nothing to reorder, so without a light preference to plan the start time around Optimize only records the state.
      // (The visited anchor does not count: only the unvisited stops are being planned.)
      // With one, the optimizer still runs: it keeps the order and searches the start time, as it does for three or more.
      if (tail.length < 2 || (tail.length === 2 && before.slice(done).every((s) => s.lightPref === "any"))) {
        await saveTrip({ routeOptimizedFor: routeSignature(trip.plannedDate, before) });
        setRouteFlowId((n) => n + 1);
        return;
      }
      const result = await api.optimizeOrder(tail.map((s): LngLat => [s.lng, s.lat]), {
        stops: tail.map((s) => ({ lightPref: s.lightPref, priority: s.priority, dwellMinutes: s.dwellMinutes })),
        plannedDate: trip.plannedDate,
        ...(planFrom ? { departAt: planFrom } : {}),
        focus: settings.optimizeFocus,
        // A trip under way keeps its start: the order and the notes are worked out for the time that will actually apply.
        ...(done > 0 ? { fixDeparture: true } : {}),
      });
      if (
        idsKeyRef.current !== startKey ||
        waypointKeyRef.current !== startWaypoints ||
        prefsKeyRef.current !== startPrefs
      ) {
        setStopsError("Your stops changed while optimizing, so the result was discarded. Try again.");
        return;
      }
      const ids = [...head, ...result.order.map((i) => tail[i])].map((s) => s.id);
      const missed = (result.misses ?? []).flatMap((m) => (tail[m.stopIndex] && !tail[m.stopIndex].visited ? [{ name: tail[m.stopIndex].name, must: m.priority === "must" }] : []));
      const misses = missed.map((m) => m.name);
      const mustMisses = missed.filter((m) => m.must).map((m) => m.name);
      const missNote = misses.length
        ? `Can't fit ${misses.length} ${misses.length === 1 ? "stop in its light" : "stops in their light"}: ${misses.join(", ")}.`
        : null;
      // Its own note (joined with ". " like the others) so the long list of names above can be collapsed on its own.
      const mustNote = mustMisses.length ? `${mustMisses.join(", ")} ${mustMisses.length === 1 ? "is a must-have" : "are must-haves"}: try fewer stops or a different order.` : null;
      // Stops visited wholly in the dark (leaving out the ones already reported for their light), and stops with no sunrise or sunset that day.
      const darkNames = (result.dark ?? []).flatMap((m) => (tail[m.stopIndex] && !tail[m.stopIndex].visited && !misses.includes(tail[m.stopIndex].name) ? [tail[m.stopIndex].name] : []));
      const darkNote = darkNames.length ? `Can't fit ${darkNames.length} ${darkNames.length === 1 ? "stop" : "stops"} in daylight: ${darkNames.join(", ")}` : null;
      const polarNames = (result.polar ?? []).flatMap((i) => (tail[i] ? [tail[i].name] : []));
      const polarNote = polarNames.length ? `No sunrise or sunset that day at ${polarNames.join(", ")}, so no daylight rule applies there` : null;
      const notes = [missNote, mustNote, darkNote, polarNote];
      // null means the departure was not searched (no light preference and no dark visit): leave it alone.
      // The optimizer's pick is kept on the planned solar day too (at the first stop of the new order, as the server checks it): the trips API refuses a start time on a neighbouring day.
      // With visited stops the trip has already started, so its start time is left alone.
      const nextDepartAt = result.departAt && done === 0 ? clampToSolarDay(new Date(result.departAt), trip.plannedDate, before[result.order[0] ?? 0].lng).toISOString() : previousDepartAt;
      const orderChanged = ids.join(",") !== startKey;
      const departChanged = !sameInstant(nextDepartAt, previousDepartAt);
      // Marks the trip optimized for the new order, in the same save as the departure.
      const optimizedFor = routeSignature(trip.plannedDate, ids.map((id) => before.find((s) => s.id === id)!));
      if (!orderChanged && !departChanged) {
        await saveTrip({ routeOptimizedFor: optimizedFor });
        setRouteFlowId((n) => n + 1);
        const usesLight = tail.some((s) => s.lightPref !== "any") || result.departAt != null;
        // Two stops have no other order to compare, so there is no verdict to give, only the light notes.
        const verdict = tail.length < 3 ? null : isExactOptimization(tail.length, usesLight) && result.complete !== false ? "Already the fastest order" : "No faster order found";
        if (verdict || notes.some(Boolean)) setOptimizeNote({ moveAt: null, notes: [verdict, ...notes], idsKey: startKey });
        return;
      }
      const previousIds = before.map((s) => s.id);
      if (orderChanged && !(await reorder(ids))) return;
      let appliedDepartAt = previousDepartAt;
      try {
        await saveTrip({ ...(departChanged && { departAt: nextDepartAt }), routeOptimizedFor: optimizedFor });
        appliedDepartAt = nextDepartAt;
        setRouteFlowId((n) => n + 1); // the route is marked optimized: the map shows every stop and runs the water along it
      } catch (e) {
        setStopsError(errorMessage(e, "Couldn't save the route"));
      }
      setUndo({ previousIds, appliedIds: ids, previousDepartAt, appliedDepartAt, previousOptimizedFor });
      // Say so when the start time moved, so the change in the Start time field is not a surprise (written out when shown).
      const moveAt = !sameInstant(appliedDepartAt, previousDepartAt) && appliedDepartAt ? appliedDepartAt : null;
      // A note is read out by the notice's own live region; announcing here as well would say it twice.
      setAnnouncement(moveAt || notes.some(Boolean) ? "" : OPTIMIZED_ANNOUNCEMENT);
      if (moveAt || notes.some(Boolean)) setOptimizeNote({ moveAt, notes, idsKey: ids.join(",") });
    } catch (e) {
      setStopsError(errorMessage(e, "Couldn't optimize the route"));
    } finally {
      setOptimizing(false);
    }
  }

  async function undoOptimize() {
    if (!undo || undoing) return;
    const { previousIds, previousDepartAt, previousOptimizedFor } = undo;
    setUndoing(true);
    try {
      // Stops ticked visited since the optimize stay first, so the old order may not come back in full.
      const fullyRestorable = pinVisitedFirst(stops, previousIds).join(",") === previousIds.join(",");
      if (previousIds.join(",") !== idsKey && !(await reorder(previousIds))) return;
      // One save for both, so the optimized mark and the start time cannot disagree.
      try {
        await saveTrip({ ...(previousDepartAt !== trip.departAt && { departAt: previousDepartAt }), routeOptimizedFor: previousOptimizedFor });
      } catch (e) {
        setStopsError(errorMessage(e, "Couldn't restore the departure time"));
      }
      setAnnouncement(fullyRestorable ? "Optimize undone. Your previous order is back." : "Optimize undone, but the previous order could not be fully restored because visited stops stay first.");
    } finally {
      setUndoing(false);
    }
  }

  async function saveStartTime(departAt: string | null) {
    const p = tracked(async () => {
      try {
        const { trip: updated } = await api.updateTrip(trip.id, { departAt });
        setTrip(updated);
        return updated.departAt;
      } catch (e) {
        setStopsError(errorMessage(e, "Couldn't save the start time"));
        return undefined;
      }
    });
    startSaveRef.current = p;
    try {
      await p;
    } finally {
      if (startSaveRef.current === p) startSaveRef.current = null;
    }
  }

  /** Optimize after a start time typed a moment ago (its blur save may still be running): wait for the save, then plan from the saved time itself. */
  async function optimizeAfterStartSave() {
    if (optimizeClickRef.current || optimizing) return;
    optimizeClickRef.current = true;
    setOptimizeWaiting(true);
    try {
      const pending = startSaveRef.current;
      const saved = pending ? await pending : undefined;
      await optimizeRef.current?.(saved === undefined ? undefined : { departAt: saved });
    } finally {
      optimizeClickRef.current = false;
      setOptimizeWaiting(false);
    }
  }

  async function resetDeparture() {
    try {
      await saveTrip({ departAt: null });
    } catch (e) {
      setStopsError(errorMessage(e, "Couldn't reset the departure time"));
    }
  }

  const canUndo = undo !== null && undo.appliedIds.join(",") === idsKey && undo.appliedDepartAt === trip.departAt;
  // Once the list or start time has moved on, this Undo is retired for good: matching them again must not revive it.
  // (Not while the optimize or the undo itself is writing, when the state is only briefly in between.)
  if (undo && !canUndo && !optimizing && !undoing) {
    setUndo(null);
    setAnnouncement((a) => (a === OPTIMIZED_ANNOUNCEMENT ? "" : a)); // "Undo is available" must not linger once it is not
  }

  /** Copy only `keys` from the server's stop onto the latest local one, so a response
   *  that raced a reorder can't overwrite `order` (or anything else it didn't change). */
  function mergeStop(stop: Stop, keys: (keyof Stop)[]) {
    setStops((prev) =>
      prev.map((s) => {
        if (s.id !== stop.id) return s;
        const next = { ...s };
        for (const k of keys) (next as Record<string, unknown>)[k] = stop[k];
        return next;
      }),
    );
  }

  /** Applies the server's answer to a stop update: the stop itself (only the keys that were sent) and the other stops whose visited flag the server changed with it. */
  function applyStopResult(res: { stop: Stop; stops?: Stop[] }, keys: (keyof Stop)[]) {
    const cascade = new Map((res.stops ?? []).map((o) => [o.id, o.visited]));
    setStops((prev) =>
      prev.map((s) => {
        if (s.id === res.stop.id) {
          const next = { ...s };
          for (const k of keys) (next as Record<string, unknown>)[k] = res.stop[k];
          return next;
        }
        return cascade.has(s.id) ? { ...s, visited: cascade.get(s.id)! } : s;
      }),
    );
  }

  async function patchStop(id: string, patch: StopPatch) {
    await tracked(async () => {
      try {
        applyStopResult(await api.updateStop(id, patch), Object.keys(patch) as (keyof Stop)[]);
        setStopsError(null);
      } catch (e) {
        markStaleOn(e);
        setStopsError(errorMessage(e, "Couldn't update the stop"));
      }
    });
  }

  /** Checking a stop checks every earlier one and unchecking it unchecks every later one. The server applies that in one step (so a stale tab cannot leave a gap) and answers with the stops it changed. */
  async function toggleVisited(id: string, visited: boolean) {
    await patchStop(id, { visited });
  }

  /** Save from the drawer. Visited cascades on the server like the list; a stop deleted elsewhere is dropped. */
  async function saveFromDrawer(id: string, patch: StopPatch) {
    await tracked(async () => {
      try {
        applyStopResult(await api.updateStop(id, patch), Object.keys(patch) as (keyof Stop)[]);
        setStopsError(null);
      } catch (e) {
        if ((e as { status?: unknown }).status !== 404) throw e;
        setStops((prev) => prev.filter((s) => s.id !== id).map((s, order) => ({ ...s, order })));
        setCardId((cur) => (cur === id ? null : cur));
        setDrawerId((cur) => (cur === id ? null : cur));
        setStopsError("This stop was deleted elsewhere, so it was removed from the list.");
        markStale();
      }
    });
  }

  /** Marker drag: move optimistically, revert on failure. */
  async function moveStop(id: string, p: LatLng) {
    const before = stops.find((s) => s.id === id);
    if (!before) return;
    const put = (at: LatLng) => setStops((cur) => cur.map((s) => (s.id === id ? { ...s, lat: at.lat, lng: at.lng } : s)));
    put(p);
    await tracked(async () => {
      try {
        mergeStop((await api.updateStop(id, { lat: p.lat, lng: p.lng })).stop, ["lat", "lng"]);
        setStopsError(null);
      } catch (e) {
        markStaleOn(e);
        put(before); // restores lat/lng only
        setStopsError(errorMessage(e, "Couldn't move the stop"));
      }
    });
  }

  async function removeStop(id: string) {
    const name = stops.find((s) => s.id === id)?.name;
    if (name === undefined) return;
    if (!(await confirm({ title: "Delete stop?", message: `Delete "${name}" from this trip?`, confirmLabel: "Delete" }))) return;
    await tracked(async () => {
      try {
        try {
          await api.deleteStop(id);
        } catch (e) {
          // Already deleted elsewhere (another tab, or a repeated request): the stop is gone, which is what was asked for.
          if ((e as { status?: unknown }).status !== 404) throw e;
        }
        const left = Math.max(stopCountRef.current - 1, 0);
        setStops((prev) => prev.filter((s) => s.id !== id).map((s, order) => ({ ...s, order })));
        setStopsError(null);
        setAnnouncement(`Deleted ${name}. ${left} ${left === 1 ? "stop" : "stops"} left in your trip.`);
        // The user may have opened something else while the delete was in flight.
        setCardId((cur) => (cur === id ? null : cur));
        setDrawerId((cur) => (cur === id ? null : cur));
      } catch (e) {
        setStopsError(errorMessage(e, "Couldn't delete the stop"));
      }
    });
  }

  function openFromList(id: string) {
    const s = stops.find((x) => x.id === id);
    if (s) setFlyTo({ lat: s.lat, lng: s.lng, nonce: Date.now() });
    setDrawerId(id);
  }

  function clickMarker(id: string) {
    lookupSeq.current++;
    setPending(null);
    setCardId(id);
  }

  // --- Suggestions -----------------------------------------------------------

  async function findSuggestions() {
    // Only a newer search supersedes this one. A change of stops doesn't discard the result (it is
    // tagged with its key, so it is just not shown) - otherwise reverting the stops left "Searching…" stuck.
    if (stops.length !== 1 && !activeRoute) return;
    const seq = ++suggestionsSeq.current;
    if (stops.length === 1) {
      const key = waypointKey;
      const { lng, lat } = stops[0];
      const kept = keptForRetry(key);
      setSuggestionsState({ key, items: [], status: "loading", error: null });
      try {
        const { suggestions: found } = await api.suggestions({ around: [lng, lat] }, { enrich: false });
        if (seq !== suggestionsSeq.current) return;
        setSuggestionsState({ key, items: found.filter((x) => haversineMeters({ lat, lng }, x) >= ALREADY_A_STOP_M), status: "done", error: null, shown: POPULARITY_BATCH });
      } catch (e) {
        if (seq !== suggestionsSeq.current) return;
        setSuggestionsState({ key, items: kept, status: "error", error: errorMessage(e, "Couldn't load suggestions. Please retry.") });
      }
      return;
    }
    if (!activeRoute) return;
    const key = waypointKey;
    const placed = stops;
    const kept = keptForRetry(key);
    setSuggestionsState({ key, items: [], status: "loading", error: null });
    askedKeyRef.current = key;
    const warm = prewarmRef.current?.key === key ? prewarmRef.current.prewarm : null;
    prewarmRef.current = null; // adopted once; a retry searches afresh
    try {
      const adopted = warm ? await adoptPrewarm(warm) : null;
      const found: Suggestion[] = adopted ?? (await api.suggestions(downsampleRoute(activeRoute.geometry), { enrich: false })).suggestions;
      if (seq !== suggestionsSeq.current) return;
      const items = found.filter((s) => !placed.some((st) => haversineMeters(st, s) < ALREADY_A_STOP_M));
      setSuggestionsState({ key, items, status: "done", error: null, shown: POPULARITY_BATCH });
    } catch (e) {
      if (seq !== suggestionsSeq.current) return;
      setSuggestionsState({ key, items: kept, status: "error", error: errorMessage(e, "Couldn't load suggestions. Please retry.") });
    }
  }

  /** A failed search keeps the list already on screen for the same route (and its saved copy) when that list is complete; a half-ranked list or a changed route starts empty. */
  function keptForRetry(key: string): Suggestion[] {
    const have = suggestionsStateRef.current;
    const complete = have && (have.restored || have.status === "error" || (have.status === "done" && have.shown === undefined));
    return have && have.key === key && complete ? have.items : [];
  }

  function dismissSuggestion(osmId: string) {
    setSuggestionsState((prev) => (prev ? { ...prev, items: prev.items.filter((s) => s.osmId !== osmId) } : prev));
  }

  /** An accepted suggestion becomes a stop, so it leaves the list; the rest stay as they are. */
  function takeSuggestion(osmId: string) {
    setSuggestionsState((prev) => (prev ? { ...prev, items: prev.items.filter((s) => s.osmId !== osmId) } : prev));
  }

  async function acceptSuggestion(s: Suggestion) {
    const added = await addStop({ name: s.name, lat: s.lat, lng: s.lng, source: "suggested", lightPref: defaultLightPref(s.kind, settings.suggestionLightPref) });
    if (added) takeSuggestion(s.osmId);
  }

  // --- Alternatives ----------------------------------------------------------

  async function findAlternatives(stop: Stop) {
    const key = waypointKey;
    const placed = stops;
    const seq = ++alternativesSeq.current;
    setAlternativesState({ stopId: stop.id, key, items: [], status: "loading", error: null });
    try {
      const { suggestions: found } = await api.suggestions({ around: [stop.lng, stop.lat], radiusKm: ALTERNATIVES_RADIUS_KM });
      if (seq !== alternativesSeq.current) return;
      // Drops the stop itself too: it sits within ALREADY_A_STOP_M of itself.
      const items = found.filter((s) => !placed.some((st) => haversineMeters(st, s) < ALREADY_A_STOP_M)).slice(0, MAX_ALTERNATIVES);
      setAlternativesState({ stopId: stop.id, key, items, status: "done", error: null });
    } catch (e) {
      if (seq !== alternativesSeq.current) return;
      setAlternativesState({ stopId: stop.id, key, items: [], status: "error", error: errorMessage(e, "Couldn't load alternatives. Please retry.") });
    }
  }

  /** Replace a stop's place in place (same order, notes and shot list kept). The old upload no longer
   *  matches the place, so the server clears it; waypointKey changes, which refreshes route, arrivals and weather. */
  async function swapStop(stop: Stop, alt: Suggestion) {
    const previous = { name: stop.name, lat: stop.lat, lng: stop.lng, source: stop.source, visited: stop.visited };
    await tracked(async () => {
    try {
      // visited:false goes through the server's visited-run rule like any other visited change (later stops are unchecked too).
      const wasVisited = new Set(stops.filter((s) => s.visited).map((s) => s.id));
      const res = await api.updateStop(stop.id, { name: alt.name, lat: alt.lat, lng: alt.lng, source: "suggested", visited: false, photoUrl: null });
      const saved = res.stop;
      applyStopResult(res, ["name", "lat", "lng", "source", "visited", "photoUrl"]);
      alternativesSeq.current++;
      setAlternativesState(null);
      setSwapNote({ stopId: stop.id, fromName: previous.name, toName: saved.name, previous, applied: { lat: saved.lat, lng: saved.lng, name: saved.name, visited: saved.visited, source: saved.source }, lostPhoto: stop.photoUrl !== null, cascadedIds: (res.stops ?? []).filter((o) => !o.visited && o.id !== stop.id && wasVisited.has(o.id)).map((o) => o.id) });
      setDrawerId(null);
      setCardId((cur) => (cur === stop.id ? null : cur));
    } catch (e) {
      markStaleOn(e);
      setStopsError(errorMessage(e, "Couldn't swap the stop"));
    }
    });
  }

  async function undoSwap() {
    if (!swapNote) return;
    await tracked(async () => {
    try {
      applyStopResult(await api.updateStop(swapNote.stopId, swapNote.previous), ["name", "lat", "lng", "source", "visited"]);
      setStopsError(null);
      setSwapNote(null);
      // The swap unticked the later visited stops with it; ticking the last of them ticks them all (and the swapped one) again.
      if (swapNote.previous.visited && swapNote.cascadedIds.length > 0) {
        const target = retickTarget(stops, swapNote.stopId, swapNote.cascadedIds);
        if (!target) {
          setStopsError("The swap was undone. The later stops were not marked visited again because the list changed.");
        } else {
          try {
            applyStopResult(await api.updateStop(target, { visited: true }), ["visited"]);
          } catch {
            setStopsError("The swap was undone, but the later stops could not be marked visited again.");
          }
        }
      }
      // An open drawer would keep showing the swapped place's fields; closing it (as a swap does) is the simple fix.
      setDrawerId((cur) => (cur === swapNote.stopId ? null : cur));
    } catch (e) {
      markStaleOn(e);
      if ((e as { status?: unknown }).status === 404) {
        setSwapNote(null);
        setStopsError("This stop was deleted elsewhere, so the swap can't be undone.");
      } else {
        setStopsError(errorMessage(e, "Couldn't undo the swap"));
      }
    }
    });
  }

  const moveText = optimizeNote?.moveAt && sameInstant(trip.departAt, optimizeNote.moveAt)
    ? `Start time moved to ${formatClock(new Date(optimizeNote.moveAt), undefined, settings.timeFormat)} so stops land in good light`
    : null;
  const optimizeParts = optimizeNote?.idsKey === idsKey ? [moveText, ...optimizeNote.notes].filter((t): t is string => !!t) : [];
  const optimizeStatus = joinNotes(optimizeParts);

  const swapped = swapNote ? stops.find((s) => s.id === swapNote.stopId) : undefined;
  const canUndoSwap = swapNote !== null && swapped !== undefined && swapped.lat === swapNote.applied.lat && swapped.lng === swapNote.applied.lng &&
    swapped.name === swapNote.applied.name && swapped.visited === swapNote.applied.visited && swapped.source === swapNote.applied.source && swapped.photoUrl === null; // a photo added since belongs to the new place

  const cardIndex = stops.findIndex((s) => s.id === cardId);
  const cardStop = cardIndex >= 0 ? stops[cardIndex] : null;
  const drawerStop = stops.find((s) => s.id === drawerId) ?? null;

  // Escape closes the place card / stop card from anywhere on the page (map, marker, body), not only while focus is inside the card.
  // It stays out of the way of typing in other fields, dialogs, the drawer and open menus, which handle Escape themselves.
  const cardOpen = pending !== null || cardStop !== null;
  const drawerOpen = drawerStop !== null;
  useEffect(() => {
    if (!cardOpen || drawerOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [aria-modal="true"], [role="combobox"], section[aria-label="Selected place"], section[aria-label="Selected stop"]')) return;
      if (document.querySelector('[role="dialog"], [aria-modal="true"], button[aria-expanded="true"]')) return;
      lookupSeq.current++;
      if (pending) setPending(null);
      else setCardId(null);
      focusSearch();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [cardOpen, drawerOpen, pending]);
  // Memoised: the real map redraws its sky lines whenever this object's identity changes.
  // The open drawer's stop wins over the map card's, so a stop opened from the list gets its lines too.
  const skyStop = drawerStop ?? cardStop;
  const sky = useMemo(() => {
    if (!skyStop || !/^\d{4}-\d{2}-\d{2}$/.test(trip.plannedDate)) return null;
    try {
      const info = getSkyInfo(skyStop.lat, skyStop.lng, trip.plannedDate);
      return { lat: skyStop.lat, lng: skyStop.lng, sunrise: info.sunrise?.bearing ?? null, sunset: info.sunset?.bearing ?? null };
    } catch {
      return null;
    }
  }, [skyStop, trip.plannedDate]);
  const freshAlternatives = alternativesState?.stopId === drawerId && alternativesState.key === waypointKey ? alternativesState : null;

  // The same note on Stops and My trip: a swap is usually made from the drawer while Stops is open.
  const swapNoteEl = swapNote && canUndoSwap && (
    <div role="status" data-testid="swap-note" className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
      <p>Swapped {swapNote.fromName} for {swapNote.toName}{swapNote.lostPhoto ? " (reference photo removed)" : ""}</p>
      <button type="button" onClick={() => void undoSwap()} className={btnGhost}>
        Undo swap
      </button>
    </div>
  );

  // Hike lines on the map: every stop's when the Show hikes setting is on (the default), else only the selected stop's. A separate layer, never part of the route.
  const hikeStops = useMemo(() => stops.filter((s) => settings.showHikes || s.id === cardId), [stops, cardId, settings.showHikes]);
  const hikePoints = useMemo(() => hikeStops.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng })), [hikeStops]);
  const hikeByStop = useHikes(hikePoints);
  const mapHikes = useMemo(() => hikeStops.flatMap((s) => { const h = hikeByStop.get(s.id); return h ? [{ id: s.id, geometry: h.geometry }] : []; }), [hikeStops, hikeByStop]);

  return (
    <main id="main-content" tabIndex={-1} className="relative h-[calc(100dvh-3rem)] overflow-hidden outline-none">
      {dialog}
      <p role="status" data-testid="announcer" className="sr-only">{announcement}</p>
      <MapView
        stops={stops}
        routeGeometry={optimized ? activeRoute?.geometry ?? null : null}
        pending={pending}
        suggestions={suggestions}
        highlightedSuggestionId={highlightedId}
        selectedId={cardId}
        sky={sky}
        hikes={mapHikes}
        drawerOpen={drawerStop !== null}
        routeFlowId={routeFlowId}
        flyTo={flyTo}
        onMapClick={(p) => void pickPoint(p)}
        onStopClick={clickMarker}
        onStopMove={(id, p) => void moveStop(id, p)}
        onSuggestionClick={pickSuggestion}
        onCenterChange={handleCenter}
      />

      <div className="pointer-events-none absolute inset-x-3 top-3 z-[15] space-y-2 lg:inset-x-auto lg:left-[24.25rem] lg:w-[28.75rem] lg:max-w-[calc(100vw-29rem)] short-landscape:inset-x-auto short-landscape:left-[calc(clamp(17.5rem,40%,23.75rem)+0.75rem)] short-landscape:right-[max(0.75rem,env(safe-area-inset-right))] short-landscape:w-auto short-landscape:max-w-none">
        <div className="pointer-events-auto">
          <SearchBar getProximity={() => centerRef.current} onSelect={selectSearchResult} inputRef={searchRef} />
        </div>
        {/* Below the large breakpoint the map controls (zoom, compass, info, Zoom to fit) run down the right edge from just under the search bar: the cards stop short of them. */}
        {pending && (
          <div className="pointer-events-auto mr-12 lg:mr-0">
            <PlaceCard
              name={pending.name}
              resolving={pending.resolving}
              busy={adding}
              full={stops.length >= MAX_ROUTE_WAYPOINTS}
              suggestion={pending.osmId ? { osmId: pending.osmId, lat: pending.lat, lng: pending.lng } : undefined}
              visit={{ lat: pending.lat, lng: pending.lng, plannedDate: trip.plannedDate }}
              onAdd={() => void addPending()}
              onClose={() => {
                lookupSeq.current++;
                setPending(null);
                focusSearch();
              }}
            />
          </div>
        )}
        {cardStop && !pending && (
          <div className="pointer-events-auto mr-12 lg:mr-0">
            <StopCard
              stop={cardStop}
              bestTime={bestTimes[cardIndex] ?? null}
              arrival={arrivals[cardIndex] ?? null}
              onToggleVisited={(visited) => void toggleVisited(cardStop.id, visited)}
              onOpenDetails={() => setDrawerId(cardStop.id)}
              onClose={() => { setCardId(null); focusSearch(); }}
            />
          </div>
        )}
      </div>

      {stops.length === 0 && !pending && (
        <p data-testid="empty-hint" className="pointer-events-none absolute inset-x-0 top-1/3 px-6 text-center text-sm text-[#4a4538]">
          Search for a place or click the map to add your first stop.
        </p>
      )}

      <StopsPanel
        header={<TripHeader trip={trip} stopCount={stops.length} onSave={saveTrip} onShareChange={(shareToken) => void tracked(async () => setTrip((t) => ({ ...t, shareToken })))} exportData={{
          stops,
          route: activeRoute?.geometry ?? null,
          pdf: {
            departAt: departAt ? new Date(departAt) : null,
            totalDistanceM: activeRoute?.distance ?? null,
            totalDurationS: activeRoute?.duration ?? null,
            stops: stops.map((s, i) => ({ name: s.name, lat: s.lat, lng: s.lng, notes: s.notes, shotNotes: s.shotNotes, lightPref: s.lightPref, arrival: arrivals[i] ?? null })),
          },
        }} />}
        collapsedSummary={
          optimized && activeRoute
            ? `${stops.length} ${stops.length === 1 ? "stop" : "stops"} · ${formatDuration(activeRoute.duration)}`
            : trip.name
        }
        summary={
          <>
            <ErrorBanner
              // The route is not drawn before Optimize, so a failure to fetch it is not worth a banner until then.
              message={current?.dismissed || !(optimized || optimizing) || activeRouteError === stopsError ? null : activeRouteError}
              onDismiss={() => setRouteResult((r) => (r ? { ...r, dismissed: true } : r))}
            />
            <ErrorBanner message={stopsError} onDismiss={() => setStopsError(null)} />
          </>
        }
        stops={
          <>
            {swapNoteEl}
            <StopList
              stops={stops}
              onReorder={(ids, movedId) => void reorder(ids, true, movedId)}
              onDelete={(id) => void removeStop(id)}
              onSelect={openFromList}
            />
          </>
        }
        trip={
          <TripPlan
            startTime={<StartTimeControl plannedDate={trip.plannedDate} departAt={trip.departAt} defaultDepartAt={defaultDepartAt} lng={stops[0]?.lng} disabled={optimizing} draft={startDraft} onDraftChange={setStartDraft} onChange={(iso) => saveStartTime(iso)} onReset={() => void resetDeparture()} />}
            optimize={{
              onOptimize: () => void optimizeAfterStartSave(),
              onUndo: canUndo && undo ? () => void undoOptimize() : null,
              busy: optimizing || optimizeWaiting,
              undoing,
              disabled: stops.length < 2 || optimizing || optimizeWaiting,
              status: optimizeStatus,
              statusParts: optimizeParts,
              reason: stops.length < 2 ? "Optimize route needs 2 stops" : undefined,
            }}
            routeStatus={
              !enoughForRoute
                ? "Add 2 stops to plan the route"
                : optimizeStale
                  ? "Your stops changed. Optimize again to see the route."
                  : !optimized
                    ? "Optimize the route to see drive times and the route line"
                    : activeRoute
                      ? `${formatDistance(activeRoute.distance, settings.distanceUnit)} · ${formatDuration(activeRoute.duration)}`
                      : activeRouteError
                        ? "Route unavailable"
                        : "Loading route…"
            }
            swapNote={swapNoteEl}
            list={
              <TripPlanList
                stops={stops}
                optimized={optimized}
                bestTimes={bestTimes}
                arrivals={arrivals}
                onToggleVisited={(id, visited) => void toggleVisited(id, visited)}
                onPriorityChange={(id, priority) => patchStop(id, { priority })}
                onSelect={openFromList}
              />
            }
          />
        }
        suggestions={
          <SuggestionsPanel
            status={suggestionsStatus}
            suggestions={suggestions}
            error={suggestionsError}
            canSearch={activeRoute !== null || stops.length === 1}
            onFind={() => void findSuggestions()}
            onAccept={acceptSuggestion}
            onDismiss={dismissSuggestion}
            onHover={setHighlightedId}
            weather={suggestionWeather}
            onDismissError={() => setSuggestionsState((prev) => (prev && prev.items.length > 0 ? { ...prev, status: "done", error: null, shown: undefined, restored: true } : { key: waypointKey, items: [], status: "idle", error: null }))}
          />
        }
        suggestionCount={suggestions.length}
      />

      {drawerStop && (
        <StopDrawer
          key={drawerStop.id}
          stop={drawerStop}
          plannedDate={trip.plannedDate}
          arrival={arrivals[stops.findIndex((s) => s.id === drawerStop.id)] ?? null}
          onClose={() => setDrawerId((cur) => (cur === drawerStop.id ? null : cur))}
          onSave={(patch) => saveFromDrawer(drawerStop.id, patch)}
          onSaveError={(message) => setStopsError(message)}
          onPhotoChange={(stop) => void tracked(async () => mergeStop(stop, ["photoUrl"]))}
          alternatives={{
            status: freshAlternatives?.status ?? "idle",
            items: freshAlternatives?.items ?? NO_SUGGESTIONS,
            error: freshAlternatives?.error ?? null,
            onFind: () => void findAlternatives(drawerStop),
            onSwap: (alt) => swapStop(drawerStop, alt),
            onDismissError: () => setAlternativesState(null),
          }}
        />
      )}
    </main>
  );
}
