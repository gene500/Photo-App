import { api } from "./api-client";
import type { PlacePhoto } from "./types";

type Place = { key: string; name: string; lat: number; lng: number };

/** A failed lookup is remembered this long, so hovering a dot repeatedly doesn't refetch every time. */
export const FAILURE_TTL_MS = 60_000;

// One fetch per place per session; the in-flight promise is shared so a hover and a click never double up.
const cache = new Map<string, { promise: Promise<PlacePhoto | null>; expiresAt: number }>();

/** Resolves to the place's photo, or null when there is none or the lookup failed (photos are decorative). */
export function loadPlacePhoto({ key, name, lat, lng }: Place): Promise<PlacePhoto | null> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.promise;
  const entry = {
    expiresAt: Infinity,
    promise: api
      .placePhoto({ name, lat, lng })
      .then((r) => r.photo)
      .catch(() => {
        entry.expiresAt = Date.now() + FAILURE_TTL_MS; // possibly transient: retry after a minute, not on every hover
        return null;
      }),
  };
  cache.set(key, entry);
  return entry.promise;
}

export function resetPlacePhotoCache(): void {
  cache.clear();
}
