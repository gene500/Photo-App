import type { LngLat } from "@/lib/types";

/** Places are bucketed into 0.1 degree squares (about 11 km), so a search reads a handful of index ranges instead of scanning. */
const CELL_DEG = 0.1;
const LNG_STRIDE = 10_000;

export function cellOf(lat: number, lng: number): number {
  return Math.floor((lat + 90) / CELL_DEG) * LNG_STRIDE + Math.floor((lng + 180) / CELL_DEG);
}

const KM_PER_DEG = 111.32;

/** Every cell the circle's bounding box touches. */
export function cellsForCircle(lat: number, lng: number, radiusKm: number): number[] {
  const dLat = radiusKm / KM_PER_DEG;
  const dLng = radiusKm / (KM_PER_DEG * Math.max(Math.cos((lat * Math.PI) / 180), 0.05));
  const out: number[] = [];
  const row0 = Math.floor((lat - dLat + 90) / CELL_DEG);
  const row1 = Math.floor((lat + dLat + 90) / CELL_DEG);
  const col0 = Math.floor((lng - dLng + 180) / CELL_DEG);
  const col1 = Math.floor((lng + dLng + 180) / CELL_DEG);
  for (let r = row0; r <= row1; r++) for (let c = col0; c <= col1; c++) out.push(r * LNG_STRIDE + c);
  return out;
}

/** Every cell a corridor polygon touches: its outline is walked in small steps, which is enough because a corridor is narrower than a cell. */
export function cellsForRing(ring: readonly LngLat[]): number[] {
  const cells = new Set<number>();
  const step = CELL_DEG / 5;
  for (let i = 0; i < ring.length; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[(i + 1) % ring.length];
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(lng2 - lng1), Math.abs(lat2 - lat1)) / step));
    for (let k = 0; k <= n; k++) cells.add(cellOf(lat1 + ((lat2 - lat1) * k) / n, lng1 + ((lng2 - lng1) * k) / n));
  }
  return [...cells];
}

/** Ray casting: is the point inside the polygon ring? */
export function pointInRing(lng: number, lat: number, ring: readonly LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
