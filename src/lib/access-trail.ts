import type { LngLat } from "@/lib/types";

export const ACCESS_TRAIL_MAX_POINTS = 120;
export const ACCESS_TRAIL_MAX_CHARS = 4000;

const isPoint = (p: unknown): p is LngLat =>
  Array.isArray(p) && p.length === 2 && typeof p[0] === "number" && typeof p[1] === "number" && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;

/** True for an array of 2..120 in-range [lng, lat] points. */
export function isLngLatList(v: unknown): v is LngLat[] {
  return Array.isArray(v) && v.length >= 2 && v.length <= ACCESS_TRAIL_MAX_POINTS && v.every(isPoint);
}

/** A stored trail (JSON text, or an already-parsed array) as points, or null when missing or invalid. Never throws. */
export function parseAccessTrail(raw: unknown): LngLat[] | null {
  let v = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return isLngLatList(v) ? v.map(([lng, lat]): LngLat => [lng, lat]) : null;
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

/** The trail as JSON with 5-decimal points (about 1 m), or null when empty, invalid or over the caps. */
export function serializeAccessTrail(trail: LngLat[] | null): string | null {
  if (!isLngLatList(trail)) return null;
  const out = JSON.stringify(trail.map(([lng, lat]) => [round5(lng), round5(lat)]));
  return out.length <= ACCESS_TRAIL_MAX_CHARS ? out : null;
}
