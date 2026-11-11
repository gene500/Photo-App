// Candidate strategies for small helpers. Each must be bit-identical to the baseline.
import { haversineMeters } from "./../baseline/geo";
const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** E1: reuse cos(lat) of the previous stop (same value, computed once). */
export function legsE1(stops: { lat: number; lng: number }[]): number[] {
  const out: number[] = [];
  if (stops.length < 2) return out;
  let aLat = stops[0]!.lat, aLng = stops[0]!.lng, cosA = Math.cos(toRad(aLat));
  for (let i = 1; i < stops.length; i++) {
    const s = stops[i]!;
    const dLat = toRad(s.lat - aLat), dLng = toRad(s.lng - aLng);
    const cosB = Math.cos(toRad(s.lat));
    const h = Math.sin(dLat / 2) ** 2 + cosA * cosB * Math.sin(dLng / 2) ** 2;
    const m = 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
    out.push(Math.round(((m * 1.3) / 1000 / 80) * 3600));
    aLat = s.lat; aLng = s.lng; cosA = cosB;
  }
  return out;
}
/** E2: plain loop calling the real haversine (no slice/map). */
export function legsE2(stops: { lat: number; lng: number }[]): number[] {
  const out = new Array<number>(Math.max(0, stops.length - 1));
  for (let i = 1; i < stops.length; i++) out[i - 1] = Math.round(((haversineMeters(stops[i - 1]!, stops[i]!) * 1.3) / 1000 / 80) * 3600);
  return out;
}
/** E3: E1 with Math.sin(x)**2 replaced by s*s (differs? ** 2 is exactly s*s in V8). */
export function legsE3(stops: { lat: number; lng: number }[]): number[] {
  const out: number[] = [];
  if (stops.length < 2) return out;
  let aLat = stops[0]!.lat, aLng = stops[0]!.lng, cosA = Math.cos(toRad(aLat));
  for (let i = 1; i < stops.length; i++) {
    const s = stops[i]!;
    const sa = Math.sin(toRad(s.lat - aLat) / 2), sb = Math.sin(toRad(s.lng - aLng) / 2);
    const cosB = Math.cos(toRad(s.lat));
    const h = sa * sa + cosA * cosB * (sb * sb);
    out.push(Math.round(((2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h)) * 1.3) / 1000 / 80) * 3600));
    aLat = s.lat; aLng = s.lng; cosA = cosB;
  }
  return out;
}

/** D1: single pass over next, array membership via the two sets. */
export function diffD1(prev: Iterable<string>, next: readonly string[]) {
  const before = new Set(prev);
  const add: string[] = [], keep: string[] = [];
  const after = new Set<string>();
  for (let i = 0; i < next.length; i++) {
    const id = next[i]!;
    after.add(id);
    if (before.has(id)) keep.push(id); else add.push(id);
  }
  const remove: string[] = [];
  for (const id of before) if (!after.has(id)) remove.push(id);
  return { add, keep, remove };
}
/** D2: removal found by counting: only build `after` when needed (skip if before empty). */
export function diffD2(prev: Iterable<string>, next: readonly string[]) {
  const before = new Set(prev);
  if (before.size === 0) return { add: next.slice(), keep: [] as string[], remove: [] as string[] };
  return diffD1(before, next);
}
/** D3: Map-based marks. */
export function diffD3(prev: Iterable<string>, next: readonly string[]) {
  const before = new Set(prev);
  const add: string[] = [], keep: string[] = [];
  const seen = new Set<string>();
  for (const id of next) { seen.add(id); (before.has(id) ? keep : add).push(id); }
  const remove: string[] = [];
  if (seen.size !== before.size || true) for (const id of before) if (!seen.has(id)) remove.push(id);
  return { add, keep, remove };
}

type S = { id: string; lat: number; lng: number; lightPref: string; priority: string; dwellMinutes: number };
function hex8(n: number) { return (n >>> 0).toString(16).padStart(8, "0"); }
function fin(h1: number, h2: number): number {
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
/** R1: both seeded hashes in one pass over the string; string built by concatenation. */
export function sigR1(plannedDate: string, stops: readonly S[]): string {
  let input = plannedDate;
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i]!;
    input += "|" + [s.id, s.lat.toFixed(6), s.lng.toFixed(6), s.lightPref, s.priority, s.dwellMinutes].join(",");
  }
  let a1 = 0xdeadbeef ^ 0, a2 = 0x41c6ce57 ^ 0, b1 = 0xdeadbeef ^ 1, b2 = 0x41c6ce57 ^ 1;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    a1 = Math.imul(a1 ^ ch, 2654435761); a2 = Math.imul(a2 ^ ch, 1597334677);
    b1 = Math.imul(b1 ^ ch, 2654435761); b2 = Math.imul(b2 ^ ch, 1597334677);
  }
  return `v1:${hex8(fin(a1, a2))}${hex8(fin(b1, b2))}`;
}
/** R2: template-literal string build instead of array join. */
export function sigR2(plannedDate: string, stops: readonly S[]): string {
  let input = plannedDate;
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i]!;
    input += `|${s.id},${s.lat.toFixed(6)},${s.lng.toFixed(6)},${s.lightPref},${s.priority},${s.dwellMinutes}`;
  }
  let a1 = 0xdeadbeef, a2 = 0x41c6ce57, b1 = 0xdeadbeef ^ 1, b2 = 0x41c6ce57 ^ 1;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    a1 = Math.imul(a1 ^ ch, 2654435761); a2 = Math.imul(a2 ^ ch, 1597334677);
    b1 = Math.imul(b1 ^ ch, 2654435761); b2 = Math.imul(b2 ^ ch, 1597334677);
  }
  return `v1:${hex8(fin(a1, a2))}${hex8(fin(b1, b2))}`;
}
