/** Display-only spreading of map markers that would overlap on screen. Never touches stored coordinates. */

export type ScreenPoint = { id: string; x: number; y: number };
export type Offset = { dx: number; dy: number };

/** Stop markers are 32px wide; closer than this (centre to centre) and they overlap. */
export const MARKER_PX = 32;

/**
 * Pixel offsets for markers whose centres are closer than `minDist` (default: one marker width).
 * Overlapping markers are grouped (transitively), and each group is spread evenly around the
 * group's centroid, in input order, so every marker can be clicked. Markers with no neighbour
 * are not returned (no offset).
 */
export function fanOffsets(points: ScreenPoint[], minDist = MARKER_PX): Map<string, Offset> {
  const parent = points.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) < minDist) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, number[]>();
  points.forEach((_, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });
  const out = new Map<string, Offset>();
  for (const idx of groups.values()) {
    const n = idx.length;
    if (n < 2) continue;
    const cx = idx.reduce((s, i) => s + points[i].x, 0) / n;
    const cy = idx.reduce((s, i) => s + points[i].y, 0) / n;
    // Neighbours on the circle are at least minDist apart (a little more for breathing room).
    const radius = n === 2 ? minDist / 2 + 2 : (minDist + 2) / (2 * Math.sin(Math.PI / n));
    idx.forEach((i, k) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * k) / n; // first marker straight up, then clockwise
      out.set(points[i].id, {
        dx: cx + radius * Math.cos(angle) - points[i].x,
        dy: cy + radius * Math.sin(angle) - points[i].y,
      });
    });
  }
  return out;
}
