import type { PlacePhoto } from "@/lib/types";
import { getCommonsPhoto } from "./commons";
import { fakePlacePhoto, isFakeExternal } from "./fake";
import { getFlickrPhoto } from "./flickr";
import type { PlaceQuery } from "./photo-http";
import { getWikipediaPhoto } from "./wikimedia";

export type PhotoProvider = (place: PlaceQuery, fetchImpl: typeof fetch) => Promise<PlacePhoto | null>;

/** Tried in order; the first hit wins. Flickr skips itself when FLICKR_API_KEY is not set. */
export const PHOTO_PROVIDERS: readonly PhotoProvider[] = [getFlickrPhoto, getCommonsPhoto, getWikipediaPhoto];

export const PHOTO_CACHE_MAX = 500;
export const PHOTO_HIT_TTL_MS = 6 * 3600_000;
export const PHOTO_MISS_TTL_MS = 15 * 60_000;

export function photoCacheKey(p: PlaceQuery): string {
  const name = p.name.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  return `${p.lat.toFixed(4)},${p.lng.toFixed(4)}|${name}`;
}

/**
 * Photo lookup with a bounded in-memory LRU (hits 6 h, misses 15 min) and in-flight de-duplication, so repeated
 * hovers - or many clients - cannot multiply requests to the photo sites. Every failure resolves to null.
 */
export function createPlacePhotoLookup(opts: { providers?: readonly PhotoProvider[]; fetchImpl?: typeof fetch; now?: () => number } = {}) {
  const providers = opts.providers ?? PHOTO_PROVIDERS;
  const now = opts.now ?? Date.now;
  const store = new Map<string, { photo: PlacePhoto | null; expiresAt: number }>(); // insertion order = recency
  const inFlight = new Map<string, Promise<PlacePhoto | null>>();

  async function run(place: PlaceQuery): Promise<PlacePhoto | null> {
    const fetchImpl = opts.fetchImpl ?? fetch;
    for (const provider of providers) {
      try {
        const photo = await provider(place, fetchImpl);
        if (photo) return photo;
      } catch {
        /* a failing provider never blocks the next one */
      }
    }
    return null;
  }

  function lookup(place: PlaceQuery): Promise<PlacePhoto | null> {
    const key = photoCacheKey(place);
    const hit = store.get(key);
    if (hit) {
      if (hit.expiresAt > now()) {
        store.delete(key);
        store.set(key, hit); // refresh recency
        return Promise.resolve(hit.photo);
      }
      store.delete(key);
    }
    const pending = inFlight.get(key);
    if (pending) return pending;
    const p = run(place)
      .then((photo) => {
        store.set(key, { photo, expiresAt: now() + (photo ? PHOTO_HIT_TTL_MS : PHOTO_MISS_TTL_MS) });
        while (store.size > PHOTO_CACHE_MAX) store.delete(store.keys().next().value as string);
        return photo;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  }

  return Object.assign(lookup, { size: () => store.size, clear: () => (store.clear(), inFlight.clear()) });
}

const shared = createPlacePhotoLookup();

/** Best-effort photo for a place: Flickr, then Wikimedia Commons, then Wikipedia. */
export async function getPlacePhoto(place: PlaceQuery): Promise<PlacePhoto | null> {
  if (isFakeExternal()) return fakePlacePhoto(place);
  return shared(place);
}
