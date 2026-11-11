import { haversineMeters } from "@/lib/geo";
import type { Suggestion, SuggestionKind } from "@/lib/types";
import { MAX_STOP_NAME } from "@/lib/validation";
import { clampText, stripNameChars } from "@/lib/text";
import { classifyKind, isDedicationName, SUGGESTION_CAP } from "../baseline/parse";

const DUPLICATE_RADIUS_M = 100;
const DEFAULT_NAME: Record<SuggestionKind, string> = { viewpoint: "Viewpoint", peak: "Peak", attraction: "Attraction" };
const KIND_RANK: Record<SuggestionKind, number> = { viewpoint: 0, peak: 1, attraction: 2 };
type OverpassElement = { type?: string; id?: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };
type Candidate = Suggestion & { named: boolean; dist: number };
const collator = new Intl.Collator();

// Strategy A: same toCandidate as baseline (verbatim); only the dedup distance check is prefiltered.
function toCandidateBase(el: OverpassElement): Candidate | null {
  if (!el || typeof el !== "object") return null;
  const rawTags = el.tags && typeof el.tags === "object" ? el.tags : {};
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawTags)) if (typeof v === "string") tags[k] = v;
  const kind = classifyKind(tags);
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (!kind || typeof el.type !== "string" || typeof el.id !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat as number) > 90 || Math.abs(lng as number) > 180) return null;
  const name = tags.name === undefined ? undefined : clampText(stripNameChars(tags.name).trim(), MAX_STOP_NAME).trim();
  if (name && isDedicationName(name)) return null;
  return { osmId: `${el.type}/${el.id}`, name: name || DEFAULT_NAME[kind], lat: lat as number, lng: lng as number, kind, named: Boolean(name), dist: 0 };
}

// Strategy B/C: no tag copy; reads the three tags it needs directly.
function toCandidateFast(el: OverpassElement): Candidate | null {
  if (!el || typeof el !== "object") return null;
  const rawTags = (el.tags && typeof el.tags === "object" ? el.tags : {}) as Record<string, unknown>;
  const tourism = rawTags.tourism;
  const natural = rawTags.natural;
  const kind: SuggestionKind | null = tourism === "viewpoint" ? "viewpoint" : natural === "peak" ? "peak" : tourism === "attraction" ? "attraction" : null;
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (!kind || typeof el.type !== "string" || typeof el.id !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat as number) > 90 || Math.abs(lng as number) > 180) return null;
  const rawName = rawTags.name;
  const name = typeof rawName !== "string" ? undefined : clampText(stripNameChars(rawName).trim(), MAX_STOP_NAME).trim();
  if (name && isDedicationName(name)) return null;
  return { osmId: `${el.type}/${el.id}`, name: name || DEFAULT_NAME[kind], lat: lat as number, lng: lng as number, kind, named: Boolean(name), dist: 0 };
}

function compareLocale(a: Candidate, b: Candidate): number {
  return KIND_RANK[a.kind] - KIND_RANK[b.kind] || Number(b.named) - Number(a.named) || a.dist - b.dist || a.osmId.localeCompare(b.osmId);
}
function compareCollator(a: Candidate, b: Candidate): number {
  return KIND_RANK[a.kind] - KIND_RANK[b.kind] || Number(b.named) - Number(a.named) || a.dist - b.dist || collator.compare(a.osmId, b.osmId);
}

/** conservative: great-circle distance >= R*|dLat| so > 0.002 deg (222 m) can never be < 100 m. */
function near(k: Candidate, c: Candidate): boolean {
  const d = k.lat - c.lat;
  if (d > 0.002 || d < -0.002) return false;
  return haversineMeters(k, c) < DUPLICATE_RADIUS_M;
}

function collect(json: unknown, toC: (e: OverpassElement) => Candidate | null, origin?: { lat: number; lng: number }): Map<string, Candidate> | null {
  const elements = (json as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(elements)) return null;
  const byId = new Map<string, Candidate>();
  for (const el of elements) {
    const c = toC(el as OverpassElement);
    if (c && !byId.has(c.osmId)) {
      if (origin) c.dist = haversineMeters(origin, c);
      byId.set(c.osmId, c);
    }
  }
  return byId;
}
const out = (kept: Candidate[]): Suggestion[] => kept.map((c) => ({ osmId: c.osmId, name: c.name, lat: c.lat, lng: c.lng, kind: c.kind }));

/** A: baseline pipeline + latitude prefilter on the dedup check. */
export function parseA(json: unknown, cap: number = SUGGESTION_CAP, origin?: { lat: number; lng: number }): Suggestion[] {
  const byId = collect(json, toCandidateBase, origin);
  if (!byId) return [];
  const kept: Candidate[] = [];
  for (const c of [...byId.values()].sort(compareLocale)) {
    if (kept.length >= cap) break;
    if (kept.some((k) => near(k, c))) continue;
    kept.push(c);
  }
  return out(kept);
}

/** B: A + no tag copying + Intl.Collator for the id tiebreak. */
export function parseB(json: unknown, cap: number = SUGGESTION_CAP, origin?: { lat: number; lng: number }): Suggestion[] {
  const byId = collect(json, toCandidateFast, origin);
  if (!byId) return [];
  const kept: Candidate[] = [];
  for (const c of [...byId.values()].sort(compareCollator)) {
    if (kept.length >= cap) break;
    if (kept.some((k) => near(k, c))) continue;
    kept.push(c);
  }
  return out(kept);
}

/** C: B but a lazy binary heap (index tiebreak = stable order) instead of sorting everything; stops once `cap` are kept. */
export function parseC(json: unknown, cap: number = SUGGESTION_CAP, origin?: { lat: number; lng: number }): Suggestion[] {
  const byId = collect(json, toCandidateFast, origin);
  if (!byId) return [];
  const items = [...byId.values()];
  const n = items.length;
  if (cap <= 0 || n === 0) return [];
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  const less = (x: number, y: number): boolean => {
    const r = compareCollator(items[x], items[y]);
    return r < 0 || (!(r > 0) && x < y);
  };
  const down = (i: number, size: number) => {
    for (;;) {
      let m = i;
      const l = 2 * i + 1, r = l + 1;
      if (l < size && less(idx[l], idx[m])) m = l;
      if (r < size && less(idx[r], idx[m])) m = r;
      if (m === i) return;
      const t = idx[i]; idx[i] = idx[m]; idx[m] = t;
      i = m;
    }
  };
  for (let i = (n >> 1) - 1; i >= 0; i--) down(i, n);
  const kept: Candidate[] = [];
  let size = n;
  while (size > 0 && kept.length < cap) {
    const top = idx[0];
    idx[0] = idx[--size];
    down(0, size);
    const c = items[top];
    if (kept.some((k) => near(k, c))) continue;
    kept.push(c);
  }
  return out(kept);
}

const FORBIDDEN_ONCE = /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]/;
const toRad = (deg: number) => (deg * Math.PI) / 180;
function toCandidateFast2(el: OverpassElement): Candidate | null {
  if (!el || typeof el !== "object") return null;
  const rawTags = (el.tags && typeof el.tags === "object" ? el.tags : {}) as Record<string, unknown>;
  const tourism = rawTags.tourism;
  const natural = rawTags.natural;
  const kind: SuggestionKind | null = tourism === "viewpoint" ? "viewpoint" : natural === "peak" ? "peak" : tourism === "attraction" ? "attraction" : null;
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (!kind || typeof el.type !== "string" || typeof el.id !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat as number) > 90 || Math.abs(lng as number) > 180) return null;
  const rawName = rawTags.name;
  let name: string | undefined;
  if (typeof rawName === "string") {
    const cleaned = FORBIDDEN_ONCE.test(rawName) ? stripNameChars(rawName) : rawName;
    name = clampText(cleaned.trim(), MAX_STOP_NAME).trim();
    if (name && isDedicationName(name)) return null;
  }
  return { osmId: `${el.type}/${el.id}`, name: name || DEFAULT_NAME[kind], lat: lat as number, lng: lng as number, kind, named: Boolean(name), dist: 0 };
}

/** D: C + name clean fast path + origin trig hoisted out of the per-element haversine (same float expressions as geo.haversineMeters). */
export function parseD(json: unknown, cap: number = SUGGESTION_CAP, origin?: { lat: number; lng: number }): Suggestion[] {
  const elements = (json as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(elements)) return [];
  const byId = new Map<string, Candidate>();
  const cosO = origin ? Math.cos(toRad(origin.lat)) : 0;
  for (let i = 0; i < elements.length; i++) {
    const c = toCandidateFast2(elements[i] as OverpassElement);
    if (c && !byId.has(c.osmId)) {
      if (origin) {
        const dLat = toRad(c.lat - origin.lat);
        const dLng = toRad(c.lng - origin.lng);
        const h = Math.sin(dLat / 2) ** 2 + cosO * Math.cos(toRad(c.lat)) * Math.sin(dLng / 2) ** 2;
        c.dist = 2 * 6_371_000 * Math.asin(Math.sqrt(h));
      }
      byId.set(c.osmId, c);
    }
  }
  const items = [...byId.values()];
  const n = items.length;
  if (cap <= 0 || n === 0) return [];
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  const less = (x: number, y: number): boolean => {
    const r = compareCollator(items[x], items[y]);
    return r < 0 || (!(r > 0) && x < y);
  };
  const down = (i: number, size: number) => {
    for (;;) {
      let m = i;
      const l = 2 * i + 1, r = l + 1;
      if (l < size && less(idx[l], idx[m])) m = l;
      if (r < size && less(idx[r], idx[m])) m = r;
      if (m === i) return;
      const t = idx[i]; idx[i] = idx[m]; idx[m] = t;
      i = m;
    }
  };
  for (let i = (n >> 1) - 1; i >= 0; i--) down(i, n);
  const kept: Candidate[] = [];
  let size = n;
  while (size > 0 && kept.length < cap) {
    const top = idx[0];
    idx[0] = idx[--size];
    down(0, size);
    const c = items[top];
    if (kept.some((k) => near(k, c))) continue;
    kept.push(c);
  }
  return out(kept);
}
