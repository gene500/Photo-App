import type { Suggestion } from "./types";

/**
 * A suggestions search started quietly once the route has been steady for a moment, so that "Find photo spots" can answer
 * from what has already arrived. Only the place list is fetched ahead: popularity lookups (the costly upstream calls)
 * wait until the person actually asks. Nothing here is shown by itself; the editor adopts the entry when asked and drops
 * it when the stops change.
 */
export type Prewarm = {
  /** Resolves with the places found; rejects if the search failed (the caller then searches afresh). */
  items: Promise<Suggestion[]>;
  startedAt: number;
};

/** Fewer places than this may be a thin answer given while a slow source was still loading, so a fresh search is better. */
export const PREWARM_MIN_PLACES = 5;
/** An older list than this is not reused. */
export const PREWARM_MAX_AGE_MS = 10 * 60_000;
/** The route must stay unchanged this long before a search is started for it. */
export const PREWARM_DELAY_MS = 1500;

export function startPrewarm(search: () => Promise<Suggestion[]>, now = Date.now()): Prewarm {
  const items = search();
  items.catch(() => {}); // a failure is handled by whoever adopts it
  return { items, startedAt: now };
}

/** The places from a prewarm if they are worth showing, else null (search afresh). */
export async function adoptPrewarm(p: Prewarm, now = Date.now()): Promise<Suggestion[] | null> {
  if (now - p.startedAt > PREWARM_MAX_AGE_MS) return null;
  try {
    const found = await p.items;
    return found.length >= PREWARM_MIN_PLACES ? found : null;
  } catch {
    return null;
  }
}
