"use client";

import { useEffect, useState } from "react";
import { btnPrimary, card } from "@/components/ui/styles";
import { formatClock, getSunWindows } from "@/lib/best-time";
import { loadPlacePhoto } from "@/lib/place-photo-cache";
import { useWeatherLine } from "@/lib/use-weather";
import type { PlacePhoto } from "@/lib/types";

/** Set when the place came from a suggestion: its photo is looked up lazily (shared cache with the map popup). */
type Source = { osmId: string; lat: number; lng: number };
/** Where and on which day the place would be visited: its evening golden-hour forecast is shown. */
type Visit = { lat: number; lng: number; plannedDate: string };
type Props = { name: string; resolving: boolean; busy: boolean; suggestion?: Source; visit?: Visit; onAdd: () => void; onClose: () => void };

export function PlaceCard({ name, resolving, busy, suggestion, visit, onAdd, onClose }: Props) {
  const osmId = suggestion?.osmId;
  const lat = suggestion?.lat;
  const lng = suggestion?.lng;
  const [loaded, setLoaded] = useState<{ key: string; photo: PlacePhoto | null } | null>(null);
  useEffect(() => {
    if (osmId === undefined || lat === undefined || lng === undefined) return;
    let current = true;
    void loadPlacePhoto({ key: osmId, name, lat, lng }).then((photo) => {
      if (current) setLoaded({ key: osmId, photo });
    });
    return () => {
      current = false;
    };
  }, [osmId, lat, lng, name]);
  // Only a photo fetched for this very place is shown; a failed image is dropped rather than left broken.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const photo = osmId !== undefined && loaded?.key === osmId && loaded.photo?.url !== failedUrl ? loaded.photo : null;

  const golden = visit ? getSunWindows(visit.lat, visit.lng, visit.plannedDate).goldenHour : null;
  const weather = useWeatherLine(visit?.lat ?? 0, visit?.lng ?? 0, golden, "golden");

  return (
    // Suggestions keep a photo-sized minimum height so the card doesn't jump when the photo arrives or is absent.
    <section aria-label="Selected place" className={`flex items-center gap-3 rounded-xl p-3 ${suggestion ? "min-h-[5.5rem]" : ""} ${card}`}>
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element -- remote thumbnail from an allow-listed host, validated server-side
        <img src={photo.url} alt={`Photo of ${name}`} width={64} height={64} referrerPolicy="no-referrer" onError={() => setFailedUrl(photo.url)} className="h-16 w-16 shrink-0 rounded-xl bg-hover object-cover" />
      )}
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${resolving ? "text-muted" : ""}`}>{name}</p>
        {golden && weather && (
          <p data-testid="place-weather" data-light-quality={weather.quality ?? undefined} className={`text-xs ${weather.quality === "poor" ? "text-danger" : "text-muted"}`}>
            Golden hour {formatClock(golden)} · {weather.text}
          </p>
        )}
        {photo && <p data-testid="photo-credit" className="text-[10px] text-muted">{photo.credit}</p>}
      </div>
      <button
        type="button"
        onClick={onAdd}
        disabled={resolving || busy}
        className={`${btnPrimary} shrink-0`}
      >
        Add stop
      </button>
      <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg leading-none text-muted hover:bg-hover">
        ×
      </button>
    </section>
  );
}
