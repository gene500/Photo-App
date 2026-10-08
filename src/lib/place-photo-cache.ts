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

const PRELOAD_TIMEOUT_MS = 8000;

/** Warms the browser's image cache for a photo so the popup shows it instantly. Resolves on load, error or timeout. */
function preloadImage(url: string): Promise<void> {
  if (typeof Image === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    const img = new Image();
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, PRELOAD_TIMEOUT_MS);
    img.onload = done;
    img.onerror = done;
    img.referrerPolicy = "no-referrer";
    img.src = url;
  });
}

/**
 * Looks up photos for a list of places in the background, in order (so list the most relevant first), a few at a time,
 * and preloads each image. Returns a cancel function: places not started yet are dropped (in-flight ones finish and
 * stay cached). Photos are decorative, so nothing here ever throws.
 */
export function prefetchPlacePhotos(places: readonly Place[], opts: { concurrency?: number; max?: number } = {}): () => void {
  const queue = places.slice(0, opts.max ?? 30);
  let cancelled = false;
  let next = 0;
  async function worker() {
    while (!cancelled && next < queue.length) {
      const place = queue[next++];
      const photo = await loadPlacePhoto(place);
      if (photo && !cancelled) await preloadImage(photo.url);
    }
  }
  for (let i = 0; i < (opts.concurrency ?? 4); i++) void worker();
  return () => {
    cancelled = true;
  };
}
