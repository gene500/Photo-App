import type { Suggestion, SuggestionKind } from "@/lib/types";
const KIND_BONUS: Record<SuggestionKind, number> = { viewpoint: 2, peak: 1, attraction: 0 };
const isWeak = (s: Suggestion) => s.notable === false && s.popularity !== undefined && s.popularity <= 2;
const rankScore = (s: Suggestion) => (s.notable ? 6 : 0) + Math.min(4, 1.5 * Math.log10(1 + (s.popularity ?? 0))) + KIND_BONUS[s.kind];

/** A: precomputed keys in parallel typed arrays, sort an index array. */
export function rankA(items: Suggestion[]): Suggestion[] {
  const n = items.length;
  const weak = new Uint8Array(n);
  const score = new Float64Array(n);
  for (let i = 0; i < n; i++) { weak[i] = isWeak(items[i]) ? 1 : 0; score[i] = rankScore(items[i]); }
  const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((a, b) => weak[a] - weak[b] || score[b] - score[a] || a - b);
  return idx.map((i) => items[i]);
}
/** B: precomputed keys on wrapper objects (same shape as baseline, no per-compare log10). */
export function rankB(items: Suggestion[]): Suggestion[] {
  return items
    .map((s, i) => ({ s, i, w: Number(isWeak(s)), r: rankScore(s) }))
    .sort((a, b) => a.w - b.w || b.r - a.r || a.i - b.i)
    .map((x) => x.s);
}
/** C: A, but skip the sort when already ordered (checks the comparator on neighbours; sort of sorted input is identity). */
export function rankC(items: Suggestion[]): Suggestion[] {
  const n = items.length;
  const weak = new Uint8Array(n);
  const score = new Float64Array(n);
  for (let i = 0; i < n; i++) { weak[i] = isWeak(items[i]) ? 1 : 0; score[i] = rankScore(items[i]); }
  let sorted = true;
  for (let i = 0; i < n; i++) if (score[i] !== score[i]) return rankA(items);
  for (let i = 1; i < n && sorted; i++) if ((weak[i - 1] - weak[i] || score[i] - score[i - 1]) > 0) sorted = false; // strict inversion
  if (sorted) return items.slice();
  return rankA(items);
}
