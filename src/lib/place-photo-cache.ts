import { api } from "./api-client";
import type { PlacePhoto } from "./types";

type Place = { key: string; name: string; lat: number; lng: number };

// One fetch per place per session; the in-flight promise is shared so a hover and a click never double up.
const cache = new Map<string, Promise<PlacePhoto | null>>();

/** Resolves to the place's photo, or null when there is none or the lookup failed (photos are decorative). */
export function loadPlacePhoto({ key, name, lat, lng }: Place): Promise<PlacePhoto | null> {
  let hit = cache.get(key);
  if (!hit) {
    hit = api
      .placePhoto({ name, lat, lng })
      .then((r) => r.photo)
      .catch(() => {
        cache.delete(key); // a failure may be transient: allow a retry
        return null;
      });
    cache.set(key, hit);
  }
  return hit;
}

export function resetPlacePhotoCache(): void {
  cache.clear();
}
