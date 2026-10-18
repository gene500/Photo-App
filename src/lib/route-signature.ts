import type { Stop } from "./types";

/** The fields the optimizer and the route read; anything else (name, notes, visited, photo) leaves a signature unchanged. */
export type SignedStop = Pick<Stop, "id" | "lat" | "lng" | "lightPref" | "priority" | "dwellMinutes">;

/** cyrb53: a fast, well-mixed 53-bit string hash (not cryptographic; it only has to notice edits). */
function cyrb53(str: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const hex8 = (n: number) => (n >>> 0).toString(16).padStart(8, "0");

/**
 * A fingerprint of the trip configuration that Optimize route decides on: the date and each stop's id, position
 * (to 1e-6 degrees), light, priority and dwell, in order. Stored as `Trip.routeOptimizedFor`; the trip counts as
 * optimized only while the current fingerprint equals it, so any later edit to those fields un-optimizes it.
 */
export function routeSignature(plannedDate: string, stops: readonly SignedStop[]): string {
  const input = [
    plannedDate,
    ...stops.map((s) => [s.id, s.lat.toFixed(6), s.lng.toFixed(6), s.lightPref, s.priority, s.dwellMinutes].join(",")),
  ].join("|");
  // 32 bits from each of two differently seeded runs: 16 hex characters.
  return `v1:${hex8(cyrb53(input, 0))}${hex8(cyrb53(input, 1))}`;
}
