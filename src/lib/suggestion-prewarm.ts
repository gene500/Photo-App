import { loadPopularityInBatches, POPULARITY_MAX, rankSuggestions } from "./suggestion-popularity";
import type { Suggestion } from "./types";

/**
 * A suggestions search started before anyone asked for it (as soon as the route is known), so that "Find photo spots"
 * can answer from what has already arrived. Popularity is looked up as soon as the places are in. Nothing here is
 * shown by itself: the editor adopts the entry when the user asks, and drops it when the stops change.
 */
export type Prewarm = {
  /** Resolves with the places found; rejects if the search failed (the caller then searches afresh). */
  items: Promise<Suggestion[]>;
  /** Popularity counts that have arrived so far, by osmId. */
  counts: Map<string, number>;
  /** True once every ranked-candidate batch has answered. */
  complete: () => boolean;
  cancel: () => void;
};

export function startPrewarm(search: () => Promise<Suggestion[]>): Prewarm {
  const counts = new Map<string, number>();
  let done = false;
  let stop: (() => void) | null = null;
  let cancelled = false;
  const items = search().then((found) => {
    if (!cancelled) {
      stop = loadPopularityInBatches(
        found,
        (c) => c.forEach((n, id) => counts.set(id, n)),
        () => {
          done = true;
        },
      );
    }
    return found;
  });
  items.catch(() => {}); // a failure is handled by whoever adopts it
  return {
    items,
    counts,
    complete: () => done,
    cancel: () => {
      cancelled = true;
      stop?.();
    },
  };
}

/** The adopted result: places with the popularity found so far, ranked; `settled` when nothing is left to look up. */
export function adoptPrewarm(found: readonly Suggestion[], p: Prewarm): { items: Suggestion[]; settled: boolean } {
  const known = found.map((s) => (p.counts.has(s.osmId) ? { ...s, popularity: p.counts.get(s.osmId) } : s));
  const settled = p.complete() || known.slice(0, POPULARITY_MAX).every((s) => s.popularity !== undefined);
  return { items: p.counts.size > 0 ? rankSuggestions(known) : known, settled };
}
