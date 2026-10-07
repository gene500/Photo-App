"use client";

import { useEffect, useMemo, useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { api } from "@/lib/api-client";
import { computeBestTimes } from "@/lib/best-time";
import { formatDistance, formatDuration } from "@/lib/format";
import { haversineMeters } from "@/lib/geo";
import type { LngLat, RouteResult, Stop, Suggestion, Trip, TripWithStops } from "@/lib/types";
import type { StopPatch, TripPatch } from "@/lib/validation";
import { MapView } from "./MapView";
import { StopDrawer } from "./StopDrawer";
import { StopList } from "./StopList";
import { SuggestionsPanel, type SuggestionsStatus } from "./SuggestionsPanel";
import { TripHeader } from "./TripHeader";

/** Hide suggestions that sit on top of an existing stop. */
const ALREADY_A_STOP_M = 100;

const errorMessage = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export function TripEditor({ initialTrip }: { initialTrip: TripWithStops }) {
  const { stops: initialStops, ...initialFields } = initialTrip;
  const [trip, setTrip] = useState<Trip>(initialFields);
  const [stops, setStops] = useState<Stop[]>(initialStops);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [stopsError, setStopsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsStatus, setSuggestionsStatus] = useState<SuggestionsStatus>("idle");
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);

  // Data flow 1 & 4: start -> ordered stops -> end. A string key so that
  // edits which don't move anything (visited, notes) don't refetch.
  const waypointKey = JSON.stringify([
    [trip.start.lng, trip.start.lat],
    ...stops.map((s) => [s.lng, s.lat]),
    [trip.end.lng, trip.end.lat],
  ]);

  useEffect(() => {
    let cancelled = false;
    api.directions(JSON.parse(waypointKey) as LngLat[]).then(
      ({ route: next }) => {
        if (cancelled) return;
        setRoute(next);
        setRouteError(null);
      },
      (e: unknown) => {
        if (cancelled) return;
        setRoute(null);
        setRouteError(errorMessage(e, "Couldn't load the route"));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [waypointKey]);

  // Data flow 5: recomputed whenever the planned date, stops, or route change.
  const bestTimes = useMemo(
    () => computeBestTimes({ start: trip.start, plannedDate: trip.plannedDate, stops }, route ? route.legs.map((l) => l.duration) : null),
    [trip.start, trip.plannedDate, stops, route],
  );

  async function saveTrip(patch: TripPatch) {
    const { trip: updated } = await api.updateTrip(trip.id, patch);
    setTrip(updated);
  }

  async function addStop(input: { name: string; lat: number; lng: number; source: "manual" | "suggested" }) {
    try {
      const { stop } = await api.addStop(trip.id, input);
      setStops((prev) => [...prev, stop]);
      return true;
    } catch (e) {
      setStopsError(errorMessage(e, "Couldn't add the stop"));
      return false;
    }
  }

  async function reorder(ids: string[]) {
    const previous = stops;
    const byId = new Map(stops.map((s) => [s.id, s]));
    setStops(ids.map((id, order) => ({ ...byId.get(id)!, order })));
    try {
      setStops((await api.reorderStops(trip.id, ids)).stops);
    } catch (e) {
      setStops(previous);
      setStopsError(errorMessage(e, "Couldn't save the new order"));
    }
  }

  function replaceStop(stop: Stop) {
    setStops((prev) => prev.map((s) => (s.id === stop.id ? stop : s)));
  }

  async function patchStop(id: string, patch: StopPatch) {
    try {
      replaceStop((await api.updateStop(id, patch)).stop);
    } catch (e) {
      setStopsError(errorMessage(e, "Couldn't update the stop"));
    }
  }

  async function removeStop(id: string) {
    if (!window.confirm("Delete this stop?")) return;
    try {
      await api.deleteStop(id);
      setStops((prev) => prev.filter((s) => s.id !== id).map((s, order) => ({ ...s, order })));
      if (selectedId === id) setSelectedId(null);
    } catch (e) {
      setStopsError(errorMessage(e, "Couldn't delete the stop"));
    }
  }

  async function findSuggestions() {
    if (!route) return;
    setSuggestionsStatus("loading");
    setSuggestionsError(null);
    try {
      const { suggestions: found } = await api.suggestions(route.geometry);
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

  const selected = stops.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="grid min-h-[calc(100vh-3rem)] grid-cols-1 lg:grid-cols-[1fr_420px]">
      <div className="relative min-h-[50vh]">
        <MapView
          start={trip.start}
          end={trip.end}
          stops={stops}
          routeGeometry={route?.geometry ?? null}
          onMapClick={({ lat, lng }) => void addStop({ name: `Pin ${stops.length + 1}`, lat, lng, source: "manual" })}
          onStopClick={setSelectedId}
        />
      </div>
      <aside className="space-y-4 overflow-y-auto border-l p-4">
        <TripHeader trip={trip} onSave={saveTrip} />
        <p data-testid="route-status" className="text-sm text-gray-700">
          {route ? `${formatDistance(route.distance)} · ${formatDuration(route.duration)}` : routeError ? "Route unavailable" : "Loading route…"}
        </p>
        <ErrorBanner message={routeError} onDismiss={() => setRouteError(null)} />
        <section className="space-y-2">
          <h2 className="font-semibold">Stops</h2>
          <p className="text-xs text-gray-500">Click the map to drop a pin. Drag ⋮⋮ to reorder.</p>
          <ErrorBanner message={stopsError} onDismiss={() => setStopsError(null)} />
          <StopList
            stops={stops}
            bestTimes={bestTimes}
            onReorder={(ids) => void reorder(ids)}
            onToggleVisited={(id, visited) => void patchStop(id, { visited })}
            onDelete={(id) => void removeStop(id)}
            onSelect={setSelectedId}
          />
        </section>
        <SuggestionsPanel
          status={suggestionsStatus}
          suggestions={suggestions}
          error={suggestionsError}
          canSearch={route !== null}
          onFind={() => void findSuggestions()}
          onAccept={(s) => void acceptSuggestion(s)}
          onDismiss={dismissSuggestion}
          onDismissError={() => {
            setSuggestionsError(null);
            setSuggestionsStatus("idle");
          }}
        />
      </aside>
      {selected && (
        <StopDrawer
          key={selected.id}
          stop={selected}
          onClose={() => setSelectedId(null)}
          onSave={async (patch) => replaceStop((await api.updateStop(selected.id, patch)).stop)}
          onPhotoChange={replaceStop}
        />
      )}
    </div>
  );
}
