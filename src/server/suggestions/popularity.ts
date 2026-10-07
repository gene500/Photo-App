import type { Suggestion } from "@/lib/types";
import { getCommonsPhotoCount } from "../external/commons";
import { flickrKey, getFlickrPhotoCount } from "../external/flickr";
import { KIND_RANK } from "./parse";

export const POPULARITY_MAX_CANDIDATES = 40;
export const POPULARITY_CONCURRENCY = 5;
export const POPULARITY_TIMEOUT_MS = 5000;

type Counter = (s: Suggestion, fetchImpl: typeof fetch) => Promise<number | undefined>;

/** Flickr totals when a key is configured (strong signal), else the number of Commons files nearby (weaker, max 50). */
function defaultCounter(): Counter {
  return flickrKey()
    ? (s, f) => getFlickrPhotoCount(s, f, POPULARITY_TIMEOUT_MS)
    : (s, f) => getCommonsPhotoCount(s, f, POPULARITY_TIMEOUT_MS);
}

/**
 * Adds `popularity` to the first 40 suggestions (5 requests at a time) and re-ranks within each kind tier by it,
 * descending; ties and unknowns keep their incoming (deterministic) order. Never throws: a failed count just
 * leaves that suggestion without popularity.
 */
export async function enrichPopularity(
  suggestions: Suggestion[],
  deps: { count?: Counter; fetchImpl?: typeof fetch } = {},
): Promise<Suggestion[]> {
  const count = deps.count ?? defaultCounter();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const head = suggestions.slice(0, POPULARITY_MAX_CANDIDATES);
  const result: (number | undefined)[] = new Array(head.length).fill(undefined);
  let next = 0;
  const worker = async () => {
    while (next < head.length) {
      const i = next++;
      try {
        const n = await count(head[i], fetchImpl);
        if (typeof n === "number" && Number.isFinite(n) && n >= 0) result[i] = n;
      } catch {
        /* no popularity for this one */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(POPULARITY_CONCURRENCY, head.length) }, worker));

  const enriched = suggestions.map((s, i) => (result[i] === undefined ? s : { ...s, popularity: result[i] }));
  return enriched
    .map((s, i) => ({ s, i }))
    .sort((a, b) => KIND_RANK[a.s.kind] - KIND_RANK[b.s.kind] || (b.s.popularity ?? -1) - (a.s.popularity ?? -1) || a.i - b.i)
    .map((x) => x.s);
}
