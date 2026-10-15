import type { Suggestion, SuggestionKind } from "./types";

const KIND_BONUS: Record<SuggestionKind, number> = { viewpoint: 2, peak: 1, attraction: 0 };
/** A place with this many photos nearby or fewer, and no Wikipedia article, is a weak suggestion. */
export const WEAK_MAX_PHOTOS = 2;

/** Known to be unremarkable: few photos and no well-read article. Unknown counts are never weak. */
export function isWeak(s: Suggestion): boolean {
  return s.notable === false && s.popularity !== undefined && s.popularity <= WEAK_MAX_PHOTOS;
}

/**
 * One score instead of kind tiers, so a famous attraction is not buried under an obscure viewpoint: a well-read Wikipedia
 * article counts most, then how many photos were taken nearby (log scale, so 1,000 vs 100 matters less than 10 vs 1),
 * and the kind only breaks near-ties.
 */
export function rankScore(s: Suggestion): number {
  return (s.notable ? 6 : 0) + Math.min(4, 1.5 * Math.log10(1 + (s.popularity ?? 0))) + KIND_BONUS[s.kind];
}

/** Best first; weak places sink to the end; ties keep their incoming (deterministic) order. */
export function rankByScore(items: Suggestion[]): Suggestion[] {
  return items
    .map((s, i) => ({ s, i }))
    .sort((a, b) => Number(isWeak(a.s)) - Number(isWeak(b.s)) || rankScore(b.s) - rankScore(a.s) || a.i - b.i)
    .map((x) => x.s);
}
