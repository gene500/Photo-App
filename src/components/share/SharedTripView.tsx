"use client";

import { useMemo, useState } from "react";
import { MapView } from "@/components/editor/MapView";
import { useSettings } from "@/components/settings/SettingsProvider";
import { DownloadDialog } from "@/components/itinerary/DownloadDialog";
import { useItineraryDownload } from "@/components/itinerary/use-itinerary-download";
import { btnGhost, card } from "@/components/ui/styles";
import { computeArrivals, computeBestTimes, describeBestTime, formatClock } from "@/lib/best-time";
import { appleMapsUrls, googleMapsUrl } from "@/lib/export";
import { buildItinerary, itineraryFileName } from "@/lib/itinerary";
import { createItineraryPdf, mapTokenFromEnv } from "@/lib/itinerary-download";
import { describeLightHint, lightLabel } from "@/lib/light-windows";
import { estimateLegDurations } from "@/lib/straight-line";
import { useMounted } from "@/lib/use-mounted";
import { stopColor } from "@/lib/stop-style";
import type { LngLat, PublicTrip, RouteResult, Stop } from "@/lib/types";

const noop = () => {};
const ESTIMATE_NOTE = "Times are estimates from straight-line distances.";

/** Read-only trip for the public share page: map with numbered pins, then the stops with times. */
export function SharedTripView({ trip, route = null }: { trip: PublicTrip; route?: RouteResult | null }) {
  // Clock times use the viewer's time zone, so they are only rendered once mounted (no server/client mismatch).
  const mounted = useMounted();
  const { settings } = useSettings();
  const tf = settings.timeFormat;
  const [selected, setSelected] = useState<string | null>(null);

  // The map takes Stop objects (a shared trip is a plan: nothing is visited); the keys are made from the order, never from database ids.
  const mapStops: Stop[] = useMemo(
    () => trip.stops.map((s) => ({ ...s, id: `stop-${s.order}`, tripId: "", notes: null, photoUrl: null, visited: false })),
    [trip.stops],
  );
  // The page fetches the real driving route on the server; without one (routing down) the line is straight and the times are estimated from distance.
  const line: LngLat[] = useMemo(() => route?.geometry ?? trip.stops.map((s) => [s.lng, s.lat]), [route, trip.stops]);
  const legs = useMemo(() => (route ? route.legs.map((l) => l.duration) : estimateLegDurations(trip.stops)), [route, trip.stops]);
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

  // Stop notes are never shared, so the links are built from names and coordinates only.
  const mapLinks = useMemo(() => {
    const stops = trip.stops.map((s) => ({ name: s.name, lat: s.lat, lng: s.lng, notes: null }));
    return { apple: appleMapsUrls(stops) ?? [], google: googleMapsUrl(stops) ?? [] };
  }, [trip.stops]);

  const download = useItineraryDownload();
  const canDownload = mounted && trip.stops.length >= 2;

  function downloadPdf() {
    download.prepare(async () => {
      const input = buildItinerary({
        tripName: trip.name,
        plannedDate: trip.plannedDate,
        departAt: trip.departAt ? new Date(trip.departAt) : null,
        totalDistanceM: route?.distance ?? null,
        totalDurationS: route?.duration ?? null,
        stops: trip.stops.map((s, i) => ({ name: s.name, lat: s.lat, lng: s.lng, notes: null, shotNotes: s.shotNotes, lightPref: s.lightPref, arrival: arrivals[i] ?? null })),
        weather: trip.stops.map(() => null),
        note: route ? null : ESTIMATE_NOTE,
        timeFormat: tf,
        distanceUnit: settings.distanceUnit,
      });
      const blob = await createItineraryPdf({ input, geometry: line, stops: trip.stops.map((s) => ({ lat: s.lat, lng: s.lng })), token: mapTokenFromEnv() });
      return { blob, fileName: itineraryFileName(trip.name, trip.plannedDate) };
    });
  }

  return (
    // print: the map and fixed-height panel give way to a plain page that lists every stop.
    <main className="relative h-dvh overflow-hidden print:h-auto print:overflow-visible">
      <div className="absolute inset-0 print:hidden">
        <MapView
          readOnly
          stops={mapStops}
          routeGeometry={line.length > 1 ? line : null}
          selectedId={selected}
          onMapClick={noop}
          onStopClick={(id) => setSelected((cur) => (cur === id ? null : id))}
        />
      </div>

      <aside aria-label="Trip panel" className={`absolute inset-x-0 bottom-0 z-10 flex h-[55dvh] flex-col overflow-hidden rounded-b-none rounded-t-2xl lg:inset-x-auto lg:bottom-3 lg:left-3 lg:top-3 lg:h-auto lg:w-[23.75rem] lg:rounded-2xl short-landscape:inset-y-0 short-landscape:left-0 short-landscape:right-auto short-landscape:h-auto short-landscape:w-[clamp(17.5rem,40%,23.75rem)] short-landscape:overflow-y-auto short-landscape:overflow-x-hidden short-landscape:rounded-none short-landscape:pb-[env(safe-area-inset-bottom)] short-landscape:pl-[env(safe-area-inset-left)] print:static print:h-auto print:w-auto print:overflow-visible print:rounded-none print:border-0 print:shadow-none ${card}`}>
        <header className="space-y-0.5 px-4 pb-2 pt-3">
          <div className="flex flex-wrap items-start justify-between gap-x-2">
            <h1 className="min-w-0 max-w-full flex-1 basis-28 break-words text-lg font-semibold">{trip.name}</h1>
            {canDownload && (
              <button type="button" onClick={downloadPdf} className={`${btnGhost} shrink-0 print:hidden`}>Download PDF</button>
            )}
          </div>
          <p className="text-sm text-muted">
            View only · planned for {trip.plannedDate}
            {mounted && trip.departAt && <> · Starts {formatClock(new Date(trip.departAt), undefined, tf)}</>}
          </p>
          {mapLinks.apple.length > 0 && (
            <p className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-sm print:hidden" data-testid="open-in-maps">
              {mapLinks.apple.map((a) => (
                <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-2 hover:text-accent-strong">
                  Open in Apple Maps{a.label && ` (${a.label})`}
                </a>
              ))}
              {mapLinks.google.map((g) => (
                <a key={g.url} href={g.url} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-2 hover:text-accent-strong">
                  Open in Google Maps{g.label && ` (${g.label})`}
                </a>
              ))}
            </p>
          )}
        </header>
        {trip.stops.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted">No stops yet.</p>
        ) : (
          <>
            <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-2 short-landscape:min-h-fit short-landscape:flex-none short-landscape:overflow-visible print:overflow-visible">
              {mapStops.map((s, i) => {
                const hint = mounted ? describeLightHint(s, arrivals[i] ?? null, undefined, tf) : null;
                const arrival = arrivals[i] ?? null;
                return (
                  <li key={s.id} data-testid="shared-stop" className={`print:break-inside-avoid flex items-start gap-3 rounded-xl p-2 ${s.id === selected ? "bg-hover" : ""}`}>
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                      style={{ background: stopColor(s) }}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <button type="button" onClick={() => setSelected(s.id === selected ? null : s.id)} className="block w-full break-words text-left text-sm font-medium leading-7 hover:underline">
                        {s.name}
                      </button>
                      {mounted && (
                        <p className="text-xs text-muted" data-testid="shared-time">
                          {hint ? hint.text : describeBestTime(bestTimes[i] ?? null, undefined, tf)}
                          {arrival && !hint && <> · Arrive ~{formatClock(arrival, undefined, tf)}</>}
                        </p>
                      )}
                      {s.lightPref !== "any" && (
                        <p className="text-xs text-muted">
                          Best at {lightLabel(s.lightPref).toLowerCase()}
                          {s.priority !== "normal" && <> · {s.priority === "must" ? "Must-have" : "High priority"}</>}
                        </p>
                      )}
                      {s.shotNotes && <p className="whitespace-pre-wrap break-words text-xs">{s.shotNotes}</p>}
                      {s.shotChecklist.length > 0 && (
                        <ul className="space-y-0.5 break-words text-xs">
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
            {!route && <p className="px-4 pb-3 text-xs text-muted">{ESTIMATE_NOTE}</p>}
          </>
        )}
      </aside>
      <DownloadDialog download={download} />
    </main>
  );
}
