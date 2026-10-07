"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { api } from "@/lib/api-client";
import { computeArrivals, computeBestTimes } from "@/lib/best-time";
import { formatDistance, formatDuration } from "@/lib/format";
import { coordsLabel, haversineMeters } from "@/lib/geo";
import type { LngLat, Place, RouteResult, Stop, StopSource, Suggestion, Trip, TripWithStops } from "@/lib/types";
import type { StopPatch, TripPatch } from "@/lib/validation";
import { MapView } from "./MapView";
import { PlaceCard } from "./PlaceCard";
import { SearchBar } from "./SearchBar";
import { StopCard } from "./StopCard";
import { StopDrawer } from "./StopDrawer";
import { StopList } from "./StopList";
import { StopsPanel } from "./StopsPanel";
import { SuggestionsPanel, type SuggestionsStatus } from "./SuggestionsPanel";
import { TripHeader } from "./TripHeader";

/** Hide suggestions that sit on top of an existing stop. */
const ALREADY_A_STOP_M = 100;

type LatLng = { lat: number; lng: number };
/** A place being considered: a search result, a clicked spot, or a suggestion. */
type Pending = LatLng & { name: string; source: StopSource; osmId?: string; resolving: boolean };

const errorMessage = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export function TripEditor({ initialTrip }: { initialTrip: TripWithStops }) {
  const { stops: initialStops, ...initialFields } = initialTrip;
  const [trip, setTrip] = useState<Trip>(initialFields);
  const [stops, setStops] = useState<Stop[]>(initialStops);
  // The outcome of the last route fetch, tagged with the waypoints it was for so a
  // stale result is never shown for different stops.
  const [routeResult, setRouteResult] = useState<{ key: string; route: RouteResult | null; error: string | null; dismissed: boolean } | null>(null);
  const [stopsError, setStopsError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [adding, setAdding] = useState(false);
  const [cardId, setCardId] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<(LatLng & { nonce: number }) | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsStatus, setSuggestionsStatus] = useState<SuggestionsStatus>("idle");
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const centerRef = useRef<LatLng | null>(null);
  const lookupSeq = useRef(0);

  const handleCenter = useCallback((c: LatLng) => {
    centerRef.current = c;
  }, []);

  // Route through the stops in order. A string key so edits that don't move anything
  // (visited, notes) don't refetch. Fewer than 2 stops means no route at all.
  const waypointKey = JSON.stringify(stops.map((s) => [s.lng, s.lat]));
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

  const enoughForRoute = stops.length >= 2;
  const current = enoughForRoute && routeResult?.key === waypointKey ? routeResult : null;
  const activeRoute = current?.route ?? null;
  const activeRouteError = current?.error ?? null;
  const legDurations = activeRoute ? activeRoute.legs.map((l) => l.duration) : null;

  const bestTimes = useMemo(
    () => computeBestTimes({ plannedDate: trip.plannedDate, stops }, legDurations),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- legDurations is derived from activeRoute
    [trip.plannedDate, stops, activeRoute],
  );
  const arrivals = useMemo(
    () => computeArrivals({ plannedDate: trip.plannedDate, stops }, legDurations),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- legDurations is derived from activeRoute
    [trip.plannedDate, stops, activeRoute],
  );

  async function saveTrip(patch: TripPatch) {
    const { trip: updated } = await api.updateTrip(trip.id, patch);
    setTrip(updated);
  }

  async function addStop(input: { name: string; lat: number; lng: number; source: StopSource }) {
    try {
      const { stop } = await api.addStop(trip.id, input);
      setStops((prev) => [...prev, stop]);
      return true;
    } catch (e) {
      setStopsError(errorMessage(e, "Couldn't add the stop"));
      return false;
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
    setPending({ lat: s.lat, lng: s.lng, name: s.name, source: "suggested", osmId: s.osmId, resolving: false });
  }

  async function addPending() {
    if (!pending || pending.resolving) return;
    setAdding(true);
    const ok = await addStop({ name: pending.name, lat: pending.lat, lng: pending.lng, source: pending.source });
    setAdding(false);
    if (!ok) return;
    if (pending.osmId) dismissSuggestion(pending.osmId);
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

  async function reorder(ids: string[]) {
    const previousOrderById = new Map(stops.map((s) => [s.id, s.order]));
    const byId = new Map(stops.map((s) => [s.id, s]));
    setStops(ids.map((id, order) => ({ ...byId.get(id)!, order })));
    try {
      const { stops: reordered } = await api.reorderStops(trip.id, ids);
      applyOrder(new Map(reordered.map((s) => [s.id, s.order])));
    } catch (e) {
      applyOrder(previousOrderById);
      setStopsError(errorMessage(e, "Couldn't save the new order"));
    }
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
    if (!window.confirm("Delete this stop?")) return;
    try {
      await api.deleteStop(id);
      setStops((prev) => prev.filter((s) => s.id !== id).map((s, order) => ({ ...s, order })));
      if (cardId === id) setCardId(null);
      if (drawerId === id) setDrawerId(null);
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
    if (!activeRoute) return;
    setSuggestionsStatus("loading");
    setSuggestionsError(null);
    try {
      const { suggestions: found } = await api.suggestions(activeRoute.geometry);
      setSuggestions(found.filter((s) => !stops.some((st) => haversineMeters(st, s) < ALREADY_A_STOP_M)));
      setSuggestionsStatus("done");
    } catch (e) {
      setSuggestionsStatus("error");
      setSuggestionsError(errorMessage(e, "Couldn't load suggestions. Please retry."));
    }
  }

  function dismissSuggestion(osmId: string) {
    setSuggestions((prev) => prev.filter((s) => s.osmId !== osmId));
  }

  async function acceptSuggestion(s: Suggestion) {
    if (await addStop({ name: s.name, lat: s.lat, lng: s.lng, source: "suggested" })) dismissSuggestion(s.osmId);
  }

  const cardIndex = stops.findIndex((s) => s.id === cardId);
  const cardStop = cardIndex >= 0 ? stops[cardIndex] : null;
  const drawerStop = stops.find((s) => s.id === drawerId) ?? null;

  return (
    <div className="relative h-[calc(100dvh-3rem)] overflow-hidden">
      <MapView
        stops={stops}
        routeGeometry={activeRoute?.geometry ?? null}
        pending={pending}
        suggestions={suggestions}
        highlightedSuggestionId={highlightedId}
        selectedId={cardId}
        flyTo={flyTo}
        onMapClick={(p) => void pickPoint(p)}
        onStopClick={clickMarker}
        onStopMove={(id, p) => void moveStop(id, p)}
        onSuggestionClick={pickSuggestion}
        onCenterChange={handleCenter}
      />

      <div className="pointer-events-none absolute inset-x-3 top-3 z-[15] space-y-2 lg:inset-x-auto lg:left-[388px] lg:w-[460px]">
        <div className="pointer-events-auto">
          <SearchBar getProximity={() => centerRef.current} onSelect={selectSearchResult} />
        </div>
        {pending && (
          <div className="pointer-events-auto">
            <PlaceCard
              name={pending.name}
              resolving={pending.resolving}
              busy={adding}
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
        <p data-testid="empty-hint" className="pointer-events-none absolute inset-x-0 top-1/3 px-6 text-center text-sm text-gray-700">
          Search for a place or click the map to add your first stop.
        </p>
      )}

      <StopsPanel
        header={<TripHeader trip={trip} onSave={saveTrip} />}
        collapsedSummary={
          activeRoute
            ? `${stops.length} ${stops.length === 1 ? "stop" : "stops"} · ${formatDuration(activeRoute.duration)}`
            : trip.name
        }
        summary={
          <>
            <p className="text-xs text-gray-500">{stops.length} {stops.length === 1 ? "stop" : "stops"}</p>
            <p data-testid="route-status" className="text-sm text-gray-700">
              {activeRoute
                ? `${formatDistance(activeRoute.distance)} · ${formatDuration(activeRoute.duration)}`
                : activeRouteError
                  ? "Route unavailable"
                  : enoughForRoute
                    ? "Loading route…"
                    : "Add 2 stops to see the route"}
            </p>
            <ErrorBanner
              message={current?.dismissed ? null : activeRouteError}
              onDismiss={() => setRouteResult((r) => (r ? { ...r, dismissed: true } : r))}
            />
            <ErrorBanner message={stopsError} onDismiss={() => setStopsError(null)} />
          </>
        }
        stops={
          <>
            <p className="text-xs text-gray-500">Drag ⋮⋮ to reorder. Click the map or search to add stops.</p>
            <StopList
              stops={stops}
              bestTimes={bestTimes}
              onReorder={(ids) => void reorder(ids)}
              onToggleVisited={(id, visited) => void patchStop(id, { visited })}
              onDelete={(id) => void removeStop(id)}
              onSelect={openFromList}
            />
          </>
        }
        suggestions={
          <SuggestionsPanel
            status={suggestionsStatus}
            suggestions={suggestions}
            error={suggestionsError}
            canSearch={activeRoute !== null}
            onFind={() => void findSuggestions()}
            onAccept={(s) => void acceptSuggestion(s)}
            onDismiss={dismissSuggestion}
            onHover={setHighlightedId}
            onDismissError={() => {
              setSuggestionsError(null);
              setSuggestionsStatus("idle");
            }}
          />
        }
        suggestionCount={suggestions.length}
      />

      {drawerStop && (
        <StopDrawer
          key={drawerStop.id}
          stop={drawerStop}
          onClose={() => setDrawerId(null)}
          onSave={async (patch) => mergeStop((await api.updateStop(drawerStop.id, patch)).stop, Object.keys(patch) as (keyof Stop)[])}
          onPhotoChange={(stop) => mergeStop(stop, ["photoUrl"])}
        />
      )}
    </div>
  );
}
