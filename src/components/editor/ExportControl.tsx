"use client";

import { btnGhost, card } from "@/components/ui/styles";
import { appleMapsUrl, buildGpx, googleMapsUrl, gpxFileName, type ExportStop } from "@/lib/export";
import type { LngLat } from "@/lib/types";
import { usePopover } from "./use-popover";

type Props = {
  tripName: string;
  stops: ExportStop[];
  /** Driven route line, when one is loaded; becomes the GPX track. */
  route: LngLat[] | null;
};

const item = "block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent-strong";

/** "Export" button with a small menu: GPX download and Google / Apple Maps directions. Needs 2+ stops. */
export function ExportControl({ tripName, stops, route }: Props) {
  const { open, setOpen, close, toggle, rootRef, triggerRef, panelRef, panelId } = usePopover();
  const enough = stops.length >= 2;
  if (open && !enough) setOpen(false); // stops were removed while the menu was open
  const google = googleMapsUrl(stops);
  const apple = appleMapsUrl(stops);

  function downloadGpx() {
    const blob = new Blob([buildGpx({ name: tripName, stops, route })], { type: "application/gpx+xml" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = gpxFileName(tripName);
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked a moment later: some browsers start the download asynchronously and need the URL until then.
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    close();
  }

  return (
    <div ref={rootRef} className="shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        disabled={!enough}
        aria-expanded={open && enough}
        aria-controls={open && enough ? panelId : undefined}
        title={enough ? undefined : "Add 2 stops to export"}
        className={`${btnGhost} disabled:opacity-50`}
      >
        Export
      </button>
      {open && enough && (
        <div ref={panelRef} id={panelId} role="group" aria-label="Export trip" className={`absolute right-0 top-full z-20 mt-1 w-56 max-w-full p-1 ${card}`}>
          <button type="button" onClick={downloadGpx} className={item}>Download GPX</button>
          {google?.map((g) => (
            <a key={g.url} href={g.url} onClick={() => close()} target="_blank" rel="noopener noreferrer" className={item}>
              Open in Google Maps{g.label && ` (${g.label})`}
            </a>
          ))}
          {apple && <a href={apple} onClick={() => close()} target="_blank" rel="noopener noreferrer" className={item}>Open in Apple Maps</a>}
        </div>
      )}
    </div>
  );
}
