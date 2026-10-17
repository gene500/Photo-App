"use client";

import { useEffect, useRef } from "react";
import { HeaderButtonLabel } from "./HeaderButtonLabel";
import { btnGhost, card } from "@/components/ui/styles";
import { appleMapsUrls, buildGpx, googleMapsUrl, gpxFileName, type ExportStop } from "@/lib/export";
import type { LngLat } from "@/lib/types";
import { useItineraryDownload } from "@/components/itinerary/use-itinerary-download";
import { useSettings } from "@/components/settings/SettingsProvider";
import { buildItinerary, itineraryFileName, type ItineraryStopSource } from "@/lib/itinerary";
import { createItineraryPdf, loadWeatherLines, mapTokenFromEnv, saveBlob } from "@/lib/itinerary-download";
import { usePopover } from "./use-popover";

type Props = {
  tripName: string;
  /** Trip date ("YYYY-MM-DD"); names the file when the trip name has no usable characters. */
  plannedDate?: string;
  stops: ExportStop[];
  /** Driven route line, when one is loaded; becomes the GPX track. */
  route: LngLat[] | null;
  /** When given, the menu offers "Download PDF" built from this. */
  pdf?: { departAt: Date | null; totalDistanceM: number | null; totalDurationS: number | null; stops: ItineraryStopSource[] };
};

const item = "block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent-strong";

/** "Export" button with a small menu: GPX download, PDF itinerary download and Google / Apple Maps directions. Needs 2+ stops. */
export function ExportControl({ tripName, plannedDate, stops, route, pdf }: Props) {
  const { open, setOpen, close, toggle, rootRef, triggerRef, panelRef, panelId } = usePopover();
  const { settings } = useSettings();
  const download = useItineraryDownload();
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  const enough = stops.length >= 2;
  if (open && !enough) setOpen(false); // stops were removed while the menu was open
  const google = googleMapsUrl(stops);
  const apple = appleMapsUrls(stops);

  function downloadGpx() {
    const blob = new Blob([buildGpx({ name: tripName, stops, route })], { type: "application/gpx+xml" });
    saveBlob(blob, gpxFileName(tripName, plannedDate));
    close();
  }

  async function downloadPdf() {
    if (!pdf) return;
    let made = false;
    await download.run(async () => {
      const weather = await loadWeatherLines({ stops: pdf.stops, unit: settings.distanceUnit });
      const input = buildItinerary({
        tripName,
        plannedDate: plannedDate ?? "",
        departAt: pdf.departAt,
        totalDistanceM: pdf.totalDistanceM,
        totalDurationS: pdf.totalDurationS,
        stops: pdf.stops,
        weather,
        note: pdf.stops.length >= 2 && pdf.stops.every((s) => s.arrival === null) ? "Arrival times are unavailable because the route has not been calculated." : null,
        timeFormat: settings.timeFormat,
        distanceUnit: settings.distanceUnit,
      });
      const blob = await createItineraryPdf({ input, geometry: route ?? [], stops: stops.map((s) => ({ lat: s.lat, lng: s.lng })), token: mapTokenFromEnv() });
      made = true;
      return { blob, fileName: itineraryFileName(tripName, plannedDate) };
    });
    if (made && openRef.current) close();
  }

  return (
    <div ref={rootRef} className="shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (!open) download.clearError();
          toggle();
        }}
        disabled={!enough}
        aria-expanded={open && enough}
        aria-controls={open && enough ? panelId : undefined}
        aria-label="Export"
        title={enough ? undefined : "Add 2 stops to export"}
        className={`${btnGhost} disabled:opacity-50`}
      >
        <HeaderButtonLabel icon="export">Export</HeaderButtonLabel>
      </button>
      {open && enough && (
        <div ref={panelRef} id={panelId} role="group" aria-label="Export trip" className={`absolute right-0 top-full z-20 mt-1 w-56 max-w-full p-1 ${card}`}>
          <button type="button" onClick={downloadGpx} className={item}>Download GPX</button>
          {pdf && (
            <button type="button" onClick={() => void downloadPdf()} aria-disabled={download.busy || undefined} className={`${item} aria-disabled:opacity-50`}>
              {download.busy ? "Preparing PDF..." : "Download PDF"}
            </button>
          )}
          {download.error && <p role="alert" className="px-3 py-2 text-sm text-danger">{download.error}</p>}
          {google?.map((g) => (
            <a key={g.url} href={g.url} onClick={() => close()} target="_blank" rel="noopener noreferrer" className={item}>
              Open in Google Maps{g.label && ` (${g.label})`}
            </a>
          ))}
          {apple?.map((a) => (
            <a key={a.url} href={a.url} onClick={() => close()} target="_blank" rel="noopener noreferrer" className={item}>
              Open in Apple Maps{a.label && ` (${a.label})`}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
