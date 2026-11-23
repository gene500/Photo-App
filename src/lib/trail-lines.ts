import type { LngLat, Stop } from "@/lib/types";

export type TrailLine = { id: string; geometry: LngLat[]; mapped: boolean };

/** One line per stop whose access is a road end: the saved trail (forced to end exactly at the stop), or the straight [road end, stop] when none is mapped. */
export function trailLines(stops: Pick<Stop, "id" | "lat" | "lng" | "access">[]): TrailLine[] {
  const out: TrailLine[] = [];
  for (const s of stops) {
    const a = s.access;
    if (!a || a.kind !== "road-end") continue;
    const end: LngLat = [s.lng, s.lat];
    const trail = a.trail && a.trail.length >= 2 ? a.trail : null;
    if (!trail) {
      out.push({ id: s.id, geometry: [[a.lng, a.lat], end], mapped: false });
      continue;
    }
    const last = trail[trail.length - 1];
    out.push({ id: s.id, geometry: last[0] === end[0] && last[1] === end[1] ? trail : [...trail, end], mapped: true });
  }
  return out;
}
