import { haversineMeters } from "@/lib/geo";
import type { Suggestion, SuggestionKind } from "@/lib/types";
import { MAX_STOP_NAME } from "@/lib/validation";
import { clampText, stripNameChars } from "@/lib/text";

export const SUGGESTION_CAP = 40;
const DUPLICATE_RADIUS_M = 100;

export function classifyKind(tags: Record<string, string>): SuggestionKind | null {
  if (tags.tourism === "viewpoint") return "viewpoint";
  if (tags.natural === "peak") return "peak";
  if (tags.tourism === "attraction") return "attraction";
  return null;
}

/**
 * Names that dedicate a bench, plaque or donated viewing spot rather than name a place ("... Foundation", "In memory of
 * ..."). Map contributors tag these as viewpoints, but they are not somewhere to plan a stop.
 */
const DEDICATION_NAME = /\b(foundation|memorial|in (loving )?memory|in (honou?r|tribute) of|bench|plaque|dedicated|donated by|donation|endowment|trust fund)\b/i;
export const isDedicationName = (name: string): boolean => DEDICATION_NAME.test(name);

const DEFAULT_NAME: Record<SuggestionKind, string> = {
  viewpoint: "Viewpoint",
  peak: "Peak",
  attraction: "Attraction",
};

const KIND_RANK: Record<SuggestionKind, number> = { viewpoint: 0, peak: 1, attraction: 2 };

type OverpassElement = {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

type Candidate = Suggestion & { named: boolean; dist: number };

// stripNameChars only changes a string that holds one of these; testing first skips two replace passes for ordinary names.
const NAME_NEEDS_CLEANING = /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]/;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const collator = new Intl.Collator();

function toCandidate(el: OverpassElement): Candidate | null {
  if (!el || typeof el !== "object") return null;
  // Only string tag values count; reading the three tags used here directly avoids copying every tag of every element.
  const tags = (el.tags && typeof el.tags === "object" ? el.tags : {}) as Record<string, unknown>;
  const kind: SuggestionKind | null = tags.tourism === "viewpoint" ? "viewpoint" : tags.natural === "peak" ? "peak" : tags.tourism === "attraction" ? "attraction" : null;
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (!kind || typeof el.type !== "string" || typeof el.id !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat as number) > 90 || Math.abs(lng as number) > 180) {
    return null;
  }
  const rawName = tags.name;
  let name: string | undefined;
  if (typeof rawName === "string") {
    const cleaned = NAME_NEEDS_CLEANING.test(rawName) ? stripNameChars(rawName) : rawName;
    name = clampText(cleaned.trim(), MAX_STOP_NAME).trim();
    if (name && isDedicationName(name)) return null;
  }
  return {
    osmId: `${el.type}/${el.id}`,
    name: name || DEFAULT_NAME[kind],
    lat: lat as number,
    lng: lng as number,
    kind,
    named: Boolean(name),
    dist: 0,
  };
}

function compare(a: Candidate, b: Candidate): number {
  return (
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    Number(b.named) - Number(a.named) ||
    a.dist - b.dist ||
    collator.compare(a.osmId, b.osmId) // same order as localeCompare, without its per-call locale lookup
  );
}

/** Whether two places are closer than the duplicate radius; great-circle distance is at least R * |dLat|, so a gap of 0.002 degrees (222 m) is never a duplicate. */
function isDuplicate(k: Candidate, c: Candidate): boolean {
  const d = k.lat - c.lat;
  if (d > 0.002 || d < -0.002) return false;
  return haversineMeters(k, c) < DUPLICATE_RADIUS_M;
}

/**
 * Ranks by kind (viewpoints, then peaks, then attractions), named before unnamed, and, when the search has a centre
 * (`origin`), nearest first, so the nearest spots win the cap; then by id, which keeps the order deterministic.
 */
export function parseOverpassResponse(json: unknown, cap: number = SUGGESTION_CAP, origin?: { lat: number; lng: number }): Suggestion[] {
  const elements = (json as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(elements)) return [];

  const byId = new Map<string, Candidate>();
  const cosOrigin = origin ? Math.cos(toRad(origin.lat)) : 0;
  for (const el of elements) {
    const c = toCandidate(el as OverpassElement);
    if (c && !byId.has(c.osmId)) {
      if (origin) {
        // haversineMeters(origin, c) with the origin's cosine computed once (same operations, same result)
        const h = Math.sin(toRad(c.lat - origin.lat) / 2) ** 2 + cosOrigin * Math.cos(toRad(c.lat)) * Math.sin(toRad(c.lng - origin.lng) / 2) ** 2;
        c.dist = 2 * 6_371_000 * Math.asin(Math.sqrt(h));
      }
      byId.set(c.osmId, c);
    }
  }

  // The cap is usually reached long before the end of a large list, so the candidates are taken best-first from a heap
  // instead of sorting them all. Ties fall back to input order, which is what a stable sort gives.
  const items = [...byId.values()];
  const n = items.length;
  const kept: Candidate[] = [];
  if (n === 0) return [];
  const heap = new Int32Array(n);
  for (let i = 0; i < n; i++) heap[i] = i;
  const before = (x: number, y: number): boolean => {
    const r = compare(items[x], items[y]);
    return r < 0 || (!(r > 0) && x < y);
  };
  const siftDown = (from: number, size: number) => {
    let i = from;
    for (;;) {
      let best = i;
      const left = 2 * i + 1;
      const right = left + 1;
      if (left < size && before(heap[left], heap[best])) best = left;
      if (right < size && before(heap[right], heap[best])) best = right;
      if (best === i) return;
      const t = heap[i];
      heap[i] = heap[best];
      heap[best] = t;
      i = best;
    }
  };
  for (let i = (n >> 1) - 1; i >= 0; i--) siftDown(i, n);
  let size = n;
  while (size > 0 && !(kept.length >= cap)) {
    const top = heap[0];
    heap[0] = heap[--size];
    siftDown(0, size);
    const c = items[top];
    if (kept.some((k) => isDuplicate(k, c))) continue;
    kept.push(c);
  }
  return kept.map((c) => ({ osmId: c.osmId, name: c.name, lat: c.lat, lng: c.lng, kind: c.kind }));
}
