import { api } from "./api-client";
import type { Suggestion, SuggestionKind } from "./types";

export const POPULARITY_BATCH = 10;
/** Only the first 40 suggestions are ranked by popularity (the same cap the server used). */
export const POPULARITY_MAX = 40;

const KIND_RANK: Record<SuggestionKind, number> = { viewpoint: 0, peak: 1, attraction: 2 };

/** Kind tier first (viewpoints, peaks, attractions), then photo count descending; unknown counts rank as 0, ties keep order. */
export function rankSuggestions(items: Suggestion[]): Suggestion[] {
  return items
    .map((s, i) => ({ s, i }))
    .sort((a, b) => KIND_RANK[a.s.kind] - KIND_RANK[b.s.kind] || (b.s.popularity ?? 0) - (a.s.popularity ?? 0) || a.i - b.i)
    .map((x) => x.s);
}

/**
 * Looks up popularity for suggestions that lack it, 10 at a time (one request per batch), calling `onBatch` after each so the
 * list can be re-ranked as it fills in. Returns a cancel function. A failed batch is skipped: popularity is only a ranking bonus.
 */
export function loadPopularityInBatches(items: readonly Suggestion[], onBatch: (counts: Map<string, number>) => void): () => void {
  const todo = items.slice(0, POPULARITY_MAX).filter((s) => s.popularity === undefined);
  let cancelled = false;
  void (async () => {
    for (let i = 0; i < todo.length && !cancelled; i += POPULARITY_BATCH) {
      const batch = todo.slice(i, i + POPULARITY_BATCH);
      try {
        const { counts } = await api.suggestionPopularity(batch.map((s) => ({ lat: s.lat, lng: s.lng })));
        if (cancelled) return;
        const found = new Map<string, number>();
        batch.forEach((s, j) => {
          const n = counts[j];
          if (typeof n === "number") found.set(s.osmId, n);
        });
        if (found.size > 0) onBatch(found);
      } catch {
        /* skip this batch */
      }
    }
  })();
  return () => {
    cancelled = true;
  };
}
