import { api } from "./api-client";
import type { Suggestion, SuggestionKind } from "./types";

/** The first chunk shows right away; each further chunk of this size is revealed as its popularity arrives. */
export const POPULARITY_BATCH = 5;
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

/** Batches in flight at once; their results are still delivered in order so the list reveals chunk by chunk. */
export const POPULARITY_PARALLEL = 2;

/**
 * Looks up popularity for suggestions that lack it, 5 at a time (one request per batch, two requests in flight at once), calling
 * `onBatch` after each in order (with the counts found, possibly none) so the list can be re-ranked and the next chunk
 * revealed. `onDone` follows the last batch. Returns a cancel function. A failed batch is skipped: popularity is only a ranking bonus.
 */
export function loadPopularityInBatches(items: readonly Suggestion[], onBatch: (counts: Map<string, number>) => void, onDone?: () => void): () => void {
  const todo = items.slice(0, POPULARITY_MAX).filter((s) => s.popularity === undefined);
  const batches: Suggestion[][] = [];
  for (let i = 0; i < todo.length; i += POPULARITY_BATCH) batches.push(todo.slice(i, i + POPULARITY_BATCH));
  let cancelled = false;
  const request = async (batch: Suggestion[]): Promise<Map<string, number> | null> => {
    try {
      const { counts } = await api.suggestionPopularity(batch.map((s) => ({ lat: s.lat, lng: s.lng })));
      const found = new Map<string, number>();
      batch.forEach((s, j) => {
        const n = counts[j];
        if (typeof n === "number") found.set(s.osmId, n);
      });
      return found;
    } catch {
      return null;
    }
  };
  void (async () => {
    const started: Promise<Map<string, number> | null>[] = [];
    const start = (i: number) => {
      if (i < batches.length && started.length === i) started.push(request(batches[i]));
    };
    for (let i = 0; i < Math.min(POPULARITY_PARALLEL, batches.length); i++) start(i);
    for (let i = 0; i < batches.length && !cancelled; i++) {
      const found = await started[i];
      if (cancelled) return;
      start(i + POPULARITY_PARALLEL); // keep two requests going while this batch is shown
      onBatch(found ?? new Map());
    }
    if (!cancelled) onDone?.();
  })();
  return () => {
    cancelled = true;
  };
}
