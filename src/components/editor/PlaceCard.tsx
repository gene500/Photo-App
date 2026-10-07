"use client";

import { useEffect, useState } from "react";
import { btnPrimary, card } from "@/components/ui/styles";
import { loadPlacePhoto } from "@/lib/place-photo-cache";
import type { PlacePhoto } from "@/lib/types";

/** Set when the place came from a suggestion: its photo is looked up lazily (shared cache with the map popup). */
type Source = { osmId: string; lat: number; lng: number };
type Props = { name: string; resolving: boolean; busy: boolean; suggestion?: Source; onAdd: () => void; onClose: () => void };

export function PlaceCard({ name, resolving, busy, suggestion, onAdd, onClose }: Props) {
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

  return (
    // Suggestions keep a photo-sized minimum height so the card doesn't jump when the photo arrives or is absent.
    <section aria-label="Selected place" className={`flex items-center gap-3 rounded-xl p-3 ${suggestion ? "min-h-[5.5rem]" : ""} ${card}`}>
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element -- remote Wikipedia thumbnail, validated server-side
        <img src={photo.url} alt={`Photo of ${name}`} width={64} height={64} referrerPolicy="no-referrer" onError={() => setFailedUrl(photo.url)} className="h-16 w-16 shrink-0 rounded-xl bg-hover object-cover" />
      )}
      <p className={`min-w-0 flex-1 text-sm font-medium ${resolving ? "text-muted" : ""}`}>{name}</p>
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
