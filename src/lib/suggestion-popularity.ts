import { api } from "./api-client";
import { rankByScore } from "./suggestion-rank";
import type { Suggestion } from "./types";

/** The first chunk shows right away; each further chunk of this size is revealed as its popularity arrives. */
export const POPULARITY_BATCH = 5;
/** Only the first 40 suggestions are ranked by popularity (the same cap the server used). */
export const POPULARITY_MAX = 40;

/** Best score first (Wikipedia notability, then photo count, then kind); weak places last; ties keep order. */
export const rankSuggestions = rankByScore;

/** Batches in flight at once; their results are still delivered in order so the list reveals chunk by chunk. */
export const POPULARITY_PARALLEL = 8; // a full list (40 places) is 8 batches: one round trip, under the 60/min limit

/**
 * Looks up popularity for suggestions that lack it, 5 at a time (one request per batch, four requests in flight at once), calling
 * `onBatch` after each in order (with the counts found, possibly none) so the list can be re-ranked and the next chunk
 * revealed. `onDone` follows the last batch. Returns a cancel function. A failed batch is skipped: popularity is only a ranking bonus.
 */
export function loadPopularityInBatches(items: readonly Suggestion[], onBatch: (counts: Map<string, number>, notable: Map<string, boolean>) => void, onDone?: () => void): () => void {
  const todo = items.slice(0, POPULARITY_MAX).filter((s) => s.popularity === undefined);
  const batches: Suggestion[][] = [];
  for (let i = 0; i < todo.length; i += POPULARITY_BATCH) batches.push(todo.slice(i, i + POPULARITY_BATCH));
  let cancelled = false;
  type Found = { counts: Map<string, number>; notable: Map<string, boolean> };
  const request = async (batch: Suggestion[]): Promise<Found | null> => {
    try {
      const { counts, notable } = await api.suggestionPopularity(batch.map((s) => ({ lat: s.lat, lng: s.lng, name: s.name })));
      const found: Found = { counts: new Map(), notable: new Map() };
      batch.forEach((s, j) => {
        const n = counts[j];
        if (typeof n === "number") found.counts.set(s.osmId, n);
        const w = notable?.[j];
        if (typeof w === "boolean") found.notable.set(s.osmId, w);
      });
      return found;
    } catch {
      return null;
    }
  };
  void (async () => {
    const started: Promise<Found | null>[] = [];
    const start = (i: number) => {
      if (i < batches.length && started.length === i) started.push(request(batches[i]));
    };
    for (let i = 0; i < Math.min(POPULARITY_PARALLEL, batches.length); i++) start(i);
    for (let i = 0; i < batches.length && !cancelled; i++) {
      const found = await started[i];
      if (cancelled) return;
      start(i + POPULARITY_PARALLEL); // keep the window of requests full while this batch is shown
      onBatch(found?.counts ?? new Map(), found?.notable ?? new Map());
    }
    if (!cancelled) onDone?.();
  })();
  return () => {
    cancelled = true;
  };
}
