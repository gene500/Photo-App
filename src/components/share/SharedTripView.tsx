"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { MapView } from "@/components/editor/MapView";
import { useSettings } from "@/components/settings/SettingsProvider";
import { card } from "@/components/ui/styles";
import { computeArrivals, computeBestTimes, describeBestTime, formatClock } from "@/lib/best-time";
import { describeLightHint, lightLabel } from "@/lib/light-windows";
import { estimateLegDurations } from "@/lib/straight-line";
import { stopColor } from "@/lib/stop-style";
import type { LngLat, PublicTrip, Stop } from "@/lib/types";

const noop = () => {};
const subscribe = () => noop;

/** Read-only trip for the public share page: map with numbered pins, then the stops with times. */
export function SharedTripView({ trip }: { trip: PublicTrip }) {
  // Clock times use the viewer's time zone, so they are only rendered once mounted (no server/client mismatch).
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const { settings } = useSettings();
  const tf = settings.timeFormat;
  const [selected, setSelected] = useState<string | null>(null);

  // The map takes Stop objects; the keys are made from the order, never from database ids.
  const mapStops: Stop[] = useMemo(
    () => trip.stops.map((s) => ({ ...s, id: `stop-${s.order}`, tripId: "", photoUrl: null })),
    [trip.stops],
  );
  // The routing API needs a login, so the line is straight and the times are estimated from distance.
  const line: LngLat[] = useMemo(() => trip.stops.map((s) => [s.lng, s.lat]), [trip.stops]);
  const legs = useMemo(() => estimateLegDurations(trip.stops), [trip.stops]);
  const timesInput = { plannedDate: trip.plannedDate, departAt: trip.departAt, stops: trip.stops };
  const arrivals = useMemo(
    () => computeArrivals(timesInput, legs),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- timesInput is rebuilt from these each render
    [trip.plannedDate, trip.departAt, trip.stops, legs],
  );
  const bestTimes = useMemo(
    () => computeBestTimes(timesInput, legs),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- timesInput is rebuilt from these each render
    [trip.plannedDate, trip.departAt, trip.stops, legs],
  );

  return (
    <main className="relative h-dvh overflow-hidden">
      <div className="absolute inset-0">
        <MapView
          readOnly
          stops={mapStops}
          routeGeometry={line.length > 1 ? line : null}
          selectedId={selected}
          onMapClick={noop}
          onStopClick={(id) => setSelected((cur) => (cur === id ? null : id))}
        />
      </div>

      <aside className={`absolute inset-x-0 bottom-0 z-10 flex h-[55dvh] flex-col overflow-hidden rounded-b-none rounded-t-2xl lg:inset-x-auto lg:bottom-3 lg:left-3 lg:top-3 lg:h-auto lg:w-[23.75rem] lg:rounded-2xl ${card}`}>
        <header className="space-y-0.5 px-4 pb-2 pt-3">
          <h1 className="text-lg font-semibold">{trip.name}</h1>
          <p className="text-sm text-muted">
            View only · planned for {trip.plannedDate}
            {mounted && trip.departAt && <> · Starts {formatClock(new Date(trip.departAt), undefined, tf)}</>}
          </p>
        </header>
        {trip.stops.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted">No stops yet.</p>
        ) : (
          <>
            <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-2">
              {mapStops.map((s, i) => {
                const hint = mounted ? describeLightHint(s, arrivals[i] ?? null, undefined, tf) : null;
                const arrival = arrivals[i] ?? null;
                return (
                  <li key={s.id} data-testid="shared-stop" className={`flex items-start gap-3 rounded-xl p-2 ${s.id === selected ? "bg-hover" : ""}`}>
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${s.visited ? "text-black/75" : "text-white"}`}
                      style={{ background: stopColor(s) }}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <button type="button" onClick={() => setSelected(s.id === selected ? null : s.id)} className="block w-full text-left text-sm font-medium leading-7 hover:underline">
                        {s.name}
                        {s.visited && <span className="ml-2 text-xs font-normal text-muted">Visited</span>}
                      </button>
                      {mounted && (
                        <p className="text-xs text-muted" data-testid="shared-time">
                          {hint ? hint.text : describeBestTime(bestTimes[i] ?? null, undefined, tf)}
                          {arrival && !hint && <> · Arrive ~{formatClock(arrival, undefined, tf)}</>}
                        </p>
                      )}
                      {s.lightPref !== "any" && <p className="text-xs text-muted">Best at {lightLabel(s.lightPref).toLowerCase()}</p>}
                      {s.notes && <p className="whitespace-pre-wrap text-xs">{s.notes}</p>}
                      {s.shotNotes && <p className="whitespace-pre-wrap text-xs">{s.shotNotes}</p>}
                      {s.shotChecklist.length > 0 && (
                        <ul className="space-y-0.5 text-xs">
                          {s.shotChecklist.map((item, j) => (
                            <li key={j} className={item.done ? "text-muted line-through" : ""}>
                              <span aria-hidden>{item.done ? "☑" : "☐"}</span> {item.text}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            <p className="px-4 pb-3 text-xs text-muted">Times are estimates from straight-line distances.</p>
          </>
        )}
      </aside>
    </main>
  );
}
