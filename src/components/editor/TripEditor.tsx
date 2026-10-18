"use client";

import { StartTimeControl } from "./StartTimeControl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { useSettings } from "@/components/settings/SettingsProvider";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { btnGhost } from "@/components/ui/styles";
import { api } from "@/lib/api-client";
import { downsampleRoute } from "@/lib/downsample";
import { adoptPrewarm, PREWARM_DELAY_MS, startPrewarm, type Prewarm } from "@/lib/suggestion-prewarm";
import { prefetchPlacePhotos } from "@/lib/place-photo-cache";
import { useSuggestionWeather } from "@/lib/use-weather";
import { holdWeather } from "@/lib/weather-cache";
import { loadPopularityInBatches, POPULARITY_BATCH, rankSuggestions } from "@/lib/suggestion-popularity";
import { clampToSolarDay, computeArrivals, computeBestTimes, formatClock } from "@/lib/best-time";
import { useMounted } from "@/lib/use-mounted";
import { fromTimeValue, toTimeValue } from "./StartTimeControl";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { useOfflineCopy } from "@/lib/use-offline-copy";
import { isExactOptimization } from "@/lib/optimize-schedule";
import { routeSignature } from "@/lib/route-signature";
import { defaultLightPref } from "@/lib/light-windows";
import { formatDistance, formatDuration } from "@/lib/format";
import { coordsLabel, haversineMeters } from "@/lib/geo";
import { getSkyInfo } from "@/lib/sky";
import type { LightPref, LngLat, Place, RouteResult, Stop, StopSource, Suggestion, Trip, TripWithStops } from "@/lib/types";
import type { StopPatch, TripPatch } from "@/lib/validation";
import { MapView } from "./MapView";
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
/** Alternatives for a stop are local: a tighter circle than the first-stop suggestions, and a short list. */
const ALTERNATIVES_RADIUS_KM = 10;
const MAX_ALTERNATIVES = 8;

type LatLng = { lat: number; lng: number };
/** A place being considered: a search result, a clicked spot, or a suggestion. */
type Pending = LatLng & { name: string; source: StopSource; osmId?: string; lightPref?: LightPref; resolving: boolean };

const NO_SUGGESTIONS: Suggestion[] = [];
const errorMessage = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

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
  useOfflineCopy(trip, stops, userId);
  // The outcome of the last route fetch, tagged with the waypoints it was for so a
  // stale result is never shown for different stops.
  const [routeResult, setRouteResult] = useState<{ key: string; route: RouteResult | null; error: string | null; dismissed: boolean } | null>(null);
  const [stopsError, setStopsError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [adding, setAdding] = useState(false);
  const [cardId, setCardId] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<(LatLng & { nonce: number }) | null>(null);
  // Tagged with the waypoints they were found for, like routeResult: a change of stops
  // makes them stale, so they are simply not shown (and a late response is dropped).
  const [suggestionsState, setSuggestionsState] = useState<{ key: string; items: Suggestion[]; status: SuggestionsStatus; error: string | null; shown?: number } | null>(null);
  const [optimizing, setOptimizing] = useState(false);
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
  const [optimizeNote, setOptimizeNote] = useState<{ text: string; idsKey: string } | null>(null);
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
  } | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const centerRef = useRef<LatLng | null>(null);
  const lookupSeq = useRef(0);

  const handleCenter = useCallback((c: LatLng) => {
    centerRef.current = c;
  }, []);

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
  const freshSuggestions = suggestionsState?.key === waypointKey ? suggestionsState : null;
  const allSuggestions = freshSuggestions?.items ?? NO_SUGGESTIONS;
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
  const popularityKey = freshSuggestions?.status === "done" ? freshSuggestions.key : null;
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
  }, [waypointKey]);

  // With a single stop there is no route to follow, so look around that stop automatically
  // (with two or more, suggestions follow the route and are found on request).
  useEffect(() => {
    const coordinates = JSON.parse(waypointKey) as LngLat[];
    if (coordinates.length !== 1) return;
    const [lng, lat] = coordinates[0];
    let cancelled = false;
    api.suggestions({ around: [lng, lat] }, { enrich: false }).then(
      ({ suggestions: found }) => {
        if (cancelled) return;
        const items = found.filter((s) => haversineMeters({ lat, lng }, s) >= ALREADY_A_STOP_M);
        setSuggestionsState({ key: waypointKey, items, status: "done", error: null, shown: POPULARITY_BATCH });
      },
      (e: unknown) => {
        if (cancelled) return;
        setSuggestionsState({ key: waypointKey, items: [], status: "error", error: errorMessage(e, "Couldn't load suggestions. Please retry.") });
      },
    );
    return () => {
      cancelled = true;
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
    const { trip: updated } = await api.updateTrip(trip.id, patch);
    setTrip(updated);
  }

  async function addStop(input: { name: string; lat: number; lng: number; source: StopSource; lightPref?: LightPref }) {
    try {
      // Only a changed default is sent; otherwise the server's own default (30) applies, exactly as before.
      const dwell = settings.defaultDwellMinutes === DEFAULT_SETTINGS.defaultDwellMinutes ? {} : { dwellMinutes: settings.defaultDwellMinutes };
      const { stop } = await api.addStop(trip.id, { ...dwell, ...input });
      setStops((prev) => [...prev, stop]);
      if (stops.length === 0 && trip.departAt === null) void saveFirstStart(stop.lng);
      return stop;
    } catch (e) {
      setStopsError(errorMessage(e, "Couldn't add the stop"));
      return null;
    }
  }

  /**
   * A new trip is created without a start time (it has no stops, so no solar day yet). With its first stop the start is
   * saved as now on the planned day at that stop, so shared and offline views show the same start as this editor.
   */
  async function saveFirstStart(lng: number) {
    const now = new Date();
    const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const iso = fromTimeValue(trip.plannedDate, clock, lng);
    if (!iso) return;
    try {
      await saveTrip({ departAt: iso });
    } catch (e) {
      setStopsError(errorMessage(e, "Couldn't save the start time"));
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
    if (seq === lookupSeq.current) setPending({ ...p, name, source: "manual", resolving: false });
  }

  function selectSearchResult(place: Place) {
    lookupSeq.current++; // cancel any in-flight click lookup
    setCardId(null);
    setPending({ lat: place.lat, lng: place.lng, name: place.name, source: "manual", resolving: false });
    setFlyTo({ lat: place.lat, lng: place.lng, nonce: Date.now() });
  }

  function pickSuggestion(osmId: string) {
    const s = suggestions.find((x) => x.osmId === osmId);
    if (!s) return;
    lookupSeq.current++;
    setCardId(null);
    setPending({ lat: s.lat, lng: s.lng, name: s.name, source: "suggested", osmId: s.osmId, lightPref: defaultLightPref(s.kind, settings.suggestionLightPref), resolving: false });
  }

  async function addPending() {
    if (!pending || pending.resolving) return;
    setAdding(true);
    const placed = await addStop({ name: pending.name, lat: pending.lat, lng: pending.lng, source: pending.source, lightPref: pending.lightPref });
    setAdding(false);
    if (!placed) return;
    if (pending.osmId) takeSuggestion(pending.osmId, placed);
    // Only close the card we added from; the user may have opened another meanwhile.
    const added = pending;
    setPending((cur) => (cur === added ? null : cur));
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
  async function reorder(ids: string[]): Promise<boolean> {
    const seq = ++reorderSeq.current;
    const previousOrderById = new Map(stops.map((s) => [s.id, s.order]));
    // Applied onto the latest state so an edit that landed since this render is never reverted.
    applyOrder(new Map(ids.map((id, order) => [id, order])));
    try {
      const { stops: reordered } = await api.reorderStops(trip.id, ids);
      // A newer drag has been sent since: its answer decides the order, not this one.
      if (seq === reorderSeq.current) applyOrder(new Map(reordered.map((s) => [s.id, s.order])));
      return true;
    } catch (e) {
      if (seq !== reorderSeq.current) return false; // superseded: do not revert over the newer order
      applyOrder(previousOrderById);
      setStopsError(errorMessage(e, "Couldn't save the new order"));
      return false;
    }
  }

  async function optimizeRoute() {
    if (optimizing || stops.length < 2) return;
    const startKey = idsKey;
    const startWaypoints = waypointKey;
    const startPrefs = prefsKey;
    const before = stops;
    const previousDepartAt = trip.departAt;
    const previousOptimizedFor = trip.routeOptimizedFor ?? null;
    setOptimizing(true);
    setOptimizeNote(null);
    try {
      // Two stops have nothing to reorder (the optimizer needs three), so Optimize only records the state.
      if (before.length < 3) {
        await saveTrip({ routeOptimizedFor: routeSignature(trip.plannedDate, before) });
        return;
      }
      const result = await api.optimizeOrder(before.map((s): LngLat => [s.lng, s.lat]), {
        stops: before.map((s) => ({ lightPref: s.lightPref, priority: s.priority, dwellMinutes: s.dwellMinutes })),
        plannedDate: trip.plannedDate,
        ...(previousDepartAt ? { departAt: previousDepartAt } : {}),
      });
      if (
        idsKeyRef.current !== startKey ||
        waypointKeyRef.current !== startWaypoints ||
        prefsKeyRef.current !== startPrefs
      ) {
        setStopsError("Your stops changed while optimizing, so the result was discarded. Try again.");
        return;
      }
      const ids = result.order.map((i) => before[i].id);
      const missed = (result.misses ?? []).flatMap((m) => (before[m.stopIndex] ? [{ name: before[m.stopIndex].name, must: m.priority === "must" }] : []));
      const misses = missed.map((m) => m.name);
      const mustMisses = missed.filter((m) => m.must).map((m) => m.name);
      const missNote = misses.length
        ? `Can't fit ${misses.length} ${misses.length === 1 ? "stop in its light" : "stops in their light"}: ${misses.join(", ")}.` +
          (mustMisses.length ? ` ${mustMisses.join(", ")} ${mustMisses.length === 1 ? "is a must-have" : "are must-haves"}: try fewer stops or a different order.` : "")
        : null;
      // null means no stop has a light preference: leave the departure alone.
      // The optimizer's pick is kept on the planned solar day too (at the first stop of the new order, as the server checks it): the trips API refuses a start time on a neighbouring day.
      const nextDepartAt = result.departAt ? clampToSolarDay(new Date(result.departAt), trip.plannedDate, before[result.order[0] ?? 0].lng).toISOString() : previousDepartAt;
      const orderChanged = ids.join(",") !== startKey;
      const departChanged = !sameInstant(nextDepartAt, previousDepartAt);
      // Marks the trip optimized for the new order, in the same save as the departure.
      const optimizedFor = routeSignature(trip.plannedDate, ids.map((id) => before.find((s) => s.id === id)!));
      if (!orderChanged && !departChanged) {
        await saveTrip({ routeOptimizedFor: optimizedFor });
        const usesLight = before.some((s) => s.lightPref !== "any");
        const verdict = isExactOptimization(before.length, usesLight) && result.complete !== false ? "Already the fastest order" : "No faster order found";
        setOptimizeNote({ text: [verdict, missNote].filter(Boolean).join(". "), idsKey: startKey });
        return;
      }
      const previousIds = before.map((s) => s.id);
      if (orderChanged && !(await reorder(ids))) return;
      let appliedDepartAt = previousDepartAt;
      try {
        await saveTrip({ ...(departChanged && { departAt: nextDepartAt }), routeOptimizedFor: optimizedFor });
        appliedDepartAt = nextDepartAt;
      } catch (e) {
        setStopsError(errorMessage(e, "Couldn't save the route"));
      }
      setUndo({ previousIds, appliedIds: ids, previousDepartAt, appliedDepartAt, previousOptimizedFor });
      // Say so when the start time moved, so the change in the Start time field is not a surprise.
      const moveNote = !sameInstant(appliedDepartAt, previousDepartAt) && appliedDepartAt ? `Start time moved to ${formatClock(new Date(appliedDepartAt), undefined, settings.timeFormat)} so stops land in their light` : null;
      const note = [moveNote, missNote].filter(Boolean).join(". ");
      if (note) setOptimizeNote({ text: note, idsKey: ids.join(",") });
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
      if (previousIds.join(",") !== idsKey && !(await reorder(previousIds))) return;
      // One save for both, so the optimized mark and the start time cannot disagree.
      try {
        await saveTrip({ ...(previousDepartAt !== trip.departAt && { departAt: previousDepartAt }), routeOptimizedFor: previousOptimizedFor });
      } catch (e) {
        setStopsError(errorMessage(e, "Couldn't restore the departure time"));
      }
    } finally {
      setUndoing(false);
    }
  }

  async function saveStartTime(departAt: string | null) {
    try {
      await saveTrip({ departAt });
    } catch (e) {
      setStopsError(errorMessage(e, "Couldn't save the start time"));
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
  if (undo && !canUndo && !optimizing && !undoing) setUndo(null);

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

  async function patchStop(id: string, patch: StopPatch) {
    try {
      mergeStop((await api.updateStop(id, patch)).stop, Object.keys(patch) as (keyof Stop)[]);
    } catch (e) {
      setStopsError(errorMessage(e, "Couldn't update the stop"));
    }
  }

  /** Marker drag: move optimistically, revert on failure. */
  async function moveStop(id: string, p: LatLng) {
    const before = stops.find((s) => s.id === id);
    if (!before) return;
    const put = (at: LatLng) => setStops((cur) => cur.map((s) => (s.id === id ? { ...s, lat: at.lat, lng: at.lng } : s)));
    put(p);
    try {
      mergeStop((await api.updateStop(id, { lat: p.lat, lng: p.lng })).stop, ["lat", "lng"]);
    } catch (e) {
      put(before); // restores lat/lng only
      setStopsError(errorMessage(e, "Couldn't move the stop"));
    }
  }

  async function removeStop(id: string) {
    const name = stops.find((s) => s.id === id)?.name;
    if (name === undefined) return;
    if (!(await confirm({ title: "Delete stop?", message: `Delete "${name}" from this trip?`, confirmLabel: "Delete" }))) return;
    try {
      try {
        await api.deleteStop(id);
      } catch (e) {
        // Already deleted elsewhere (another tab, or a repeated request): the stop is gone, which is what was asked for.
        if ((e as { status?: unknown }).status !== 404) throw e;
      }
      setStops((prev) => prev.filter((s) => s.id !== id).map((s, order) => ({ ...s, order })));
      // The user may have opened something else while the delete was in flight.
      setCardId((cur) => (cur === id ? null : cur));
      setDrawerId((cur) => (cur === id ? null : cur));
    } catch (e) {
      setStopsError(errorMessage(e, "Couldn't delete the stop"));
    }
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
      setSuggestionsState({ key, items: [], status: "loading", error: null });
      try {
        const { suggestions: found } = await api.suggestions({ around: [lng, lat] }, { enrich: false });
        if (seq !== suggestionsSeq.current) return;
        setSuggestionsState({ key, items: found.filter((x) => haversineMeters({ lat, lng }, x) >= ALREADY_A_STOP_M), status: "done", error: null, shown: POPULARITY_BATCH });
      } catch (e) {
        if (seq !== suggestionsSeq.current) return;
        setSuggestionsState({ key, items: [], status: "error", error: errorMessage(e, "Couldn't load suggestions. Please retry.") });
      }
      return;
    }
    if (!activeRoute) return;
    const key = waypointKey;
    const placed = stops;
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
      setSuggestionsState({ key, items: [], status: "error", error: errorMessage(e, "Couldn't load suggestions. Please retry.") });
    }
  }

  function dismissSuggestion(osmId: string) {
    setSuggestionsState((prev) => (prev ? { ...prev, items: prev.items.filter((s) => s.osmId !== osmId) } : prev));
  }

  /** An accepted suggestion adds a stop, which changes the waypoints. Remove it and keep
   *  the rest valid by re-tagging them with the key that now includes the new stop. */
  function takeSuggestion(osmId: string, added: Stop) {
    setSuggestionsState((prev) => {
      if (!prev) return prev;
      const items = prev.items.filter((s) => s.osmId !== osmId);
      const key = JSON.stringify([...(JSON.parse(prev.key) as LngLat[]), [added.lng, added.lat]]);
      // Re-tag only suggestions that were current just before this stop was added
      // (the ref may or may not have caught up with the new stop yet).
      const wasCurrent = prev.key === waypointKeyRef.current || key === waypointKeyRef.current;
      return { ...prev, key: wasCurrent ? key : prev.key, items };
    });
  }

  async function acceptSuggestion(s: Suggestion) {
    const added = await addStop({ name: s.name, lat: s.lat, lng: s.lng, source: "suggested", lightPref: defaultLightPref(s.kind, settings.suggestionLightPref) });
    if (added) takeSuggestion(s.osmId, added);
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
    try {
      const { stop: saved } = await api.updateStop(stop.id, { name: alt.name, lat: alt.lat, lng: alt.lng, source: "suggested", visited: false, photoUrl: null });
      mergeStop(saved, ["name", "lat", "lng", "source", "visited", "photoUrl"]);
      alternativesSeq.current++;
      setAlternativesState(null);
      setSwapNote({ stopId: stop.id, fromName: previous.name, toName: saved.name, previous, applied: { lat: saved.lat, lng: saved.lng, name: saved.name, visited: saved.visited, source: saved.source }, lostPhoto: stop.photoUrl !== null });
      setDrawerId(null);
      setCardId((cur) => (cur === stop.id ? null : cur));
    } catch (e) {
      setStopsError(errorMessage(e, "Couldn't swap the stop"));
    }
  }

  async function undoSwap() {
    if (!swapNote) return;
    try {
      mergeStop((await api.updateStop(swapNote.stopId, swapNote.previous)).stop, ["name", "lat", "lng", "source", "visited"]);
      setSwapNote(null);
      // An open drawer would keep showing the swapped place's fields; closing it (as a swap does) is the simple fix.
      setDrawerId((cur) => (cur === swapNote.stopId ? null : cur));
    } catch (e) {
      setStopsError(errorMessage(e, "Couldn't undo the swap"));
    }
  }

  const swapped = swapNote ? stops.find((s) => s.id === swapNote.stopId) : undefined;
  const canUndoSwap = swapNote !== null && swapped !== undefined && swapped.lat === swapNote.applied.lat && swapped.lng === swapNote.applied.lng &&
    swapped.name === swapNote.applied.name && swapped.visited === swapNote.applied.visited && swapped.source === swapNote.applied.source && swapped.photoUrl === null; // a photo added since belongs to the new place

  const cardIndex = stops.findIndex((s) => s.id === cardId);
  const cardStop = cardIndex >= 0 ? stops[cardIndex] : null;
  const drawerStop = stops.find((s) => s.id === drawerId) ?? null;
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

  return (
    <div className="relative h-[calc(100dvh-3rem)] overflow-hidden">
      {dialog}
      <MapView
        stops={stops}
        routeGeometry={optimized ? activeRoute?.geometry ?? null : null}
        pending={pending}
        suggestions={suggestions}
        highlightedSuggestionId={highlightedId}
        selectedId={cardId}
        sky={sky}
        flyTo={flyTo}
        onMapClick={(p) => void pickPoint(p)}
        onStopClick={clickMarker}
        onStopMove={(id, p) => void moveStop(id, p)}
        onSuggestionClick={pickSuggestion}
        onCenterChange={handleCenter}
      />

      <div className="pointer-events-none absolute inset-x-3 top-0 z-[15] space-y-2 lg:inset-x-auto lg:left-[24.25rem] lg:w-[28.75rem] lg:max-w-[calc(100vw-29rem)]">
        <div className="pointer-events-auto">
          <SearchBar getProximity={() => centerRef.current} onSelect={selectSearchResult} />
        </div>
        {pending && (
          <div className="pointer-events-auto">
            <PlaceCard
              name={pending.name}
              resolving={pending.resolving}
              busy={adding}
              suggestion={pending.osmId ? { osmId: pending.osmId, lat: pending.lat, lng: pending.lng } : undefined}
              visit={{ lat: pending.lat, lng: pending.lng, plannedDate: trip.plannedDate }}
              onAdd={() => void addPending()}
              onClose={() => {
                lookupSeq.current++;
                setPending(null);
              }}
            />
          </div>
        )}
        {cardStop && !pending && (
          <div className="pointer-events-auto">
            <StopCard
              stop={cardStop}
              bestTime={bestTimes[cardIndex] ?? null}
              arrival={arrivals[cardIndex] ?? null}
              onToggleVisited={(visited) => void patchStop(cardStop.id, { visited })}
              onOpenDetails={() => setDrawerId(cardStop.id)}
              onClose={() => setCardId(null)}
            />
          </div>
        )}
      </div>

      {stops.length === 0 && !pending && (
        <p data-testid="empty-hint" className="pointer-events-none absolute inset-x-0 top-1/3 px-6 text-center text-sm text-muted">
          Search for a place or click the map to add your first stop.
        </p>
      )}

      <StopsPanel
        header={<TripHeader trip={trip} onSave={saveTrip} onShareChange={(shareToken) => setTrip((t) => ({ ...t, shareToken }))} exportData={{
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
            <p className="text-sm text-muted">{stops.length} {stops.length === 1 ? "stop" : "stops"}</p>
            <ErrorBanner
              // The route is not drawn before Optimize, so a failure to fetch it is not worth a banner until then.
              message={current?.dismissed || !(optimized || optimizing) ? null : activeRouteError}
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
              onReorder={(ids) => void reorder(ids)}
              onDelete={(id) => void removeStop(id)}
              onSelect={openFromList}
            />
          </>
        }
        trip={
          <TripPlan
            startTime={<StartTimeControl plannedDate={trip.plannedDate} departAt={trip.departAt} defaultDepartAt={defaultDepartAt} lng={stops[0]?.lng} disabled={optimizing} draft={startDraft} onDraftChange={setStartDraft} onChange={(iso) => saveStartTime(iso)} onReset={() => void resetDeparture()} />}
            optimize={{
              onOptimize: () => void optimizeRoute(),
              onUndo: canUndo && undo ? () => void undoOptimize() : null,
              busy: optimizing,
              undoing,
              disabled: stops.length < 2 || optimizing,
              status: optimizeNote?.idsKey === idsKey ? optimizeNote.text : "",
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
                onToggleVisited={(id, visited) => void patchStop(id, { visited })}
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
            onDismissError={() => setSuggestionsState({ key: waypointKey, items: [], status: "idle", error: null })}
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
          onClose={() => setDrawerId(null)}
          onSave={async (patch) => mergeStop((await api.updateStop(drawerStop.id, patch)).stop, Object.keys(patch) as (keyof Stop)[])}
          onPhotoChange={(stop) => mergeStop(stop, ["photoUrl"])}
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
    </div>
  );
}
