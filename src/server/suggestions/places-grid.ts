import { haversineMeters } from "@/lib/geo";
import type { LngLat } from "@/lib/types";

/** Places are bucketed into 0.1 degree squares (about 11 km), so a search reads a handful of index ranges instead of scanning. */
const CELL_DEG = 0.1;
const LNG_STRIDE = 10_000;

export function cellOf(lat: number, lng: number): number {
  return Math.floor((lat + 90) / CELL_DEG) * LNG_STRIDE + Math.floor((lng + 180) / CELL_DEG);
}

const KM_PER_DEG = 111.32;

/** Every cell the circle touches: the bounding box's cells, minus the corner cells that lie wholly outside the circle (about a fifth fewer). */
export function cellsForCircle(lat: number, lng: number, radiusKm: number): number[] {
  const dLat = radiusKm / KM_PER_DEG;
  const dLng = radiusKm / (KM_PER_DEG * Math.max(Math.cos((lat * Math.PI) / 180), 0.05));
  const out: number[] = [];
  const row0 = Math.floor((lat - dLat + 90) / CELL_DEG);
  const row1 = Math.floor((lat + dLat + 90) / CELL_DEG);
  const col0 = Math.floor((lng - dLng + 180) / CELL_DEG);
  const col1 = Math.floor((lng + dLng + 180) / CELL_DEG);
  // A little slack (1 % + 300 m) keeps this conservative: the box maths and haversine differ slightly, and a cell must never be missed.
  const reach = radiusKm * 1010 + 300;
  for (let r = row0; r <= row1; r++) {
    const nearLat = Math.min(Math.max(lat, r * CELL_DEG - 90), (r + 1) * CELL_DEG - 90);
    for (let c = col0; c <= col1; c++) {
      const nearLng = Math.min(Math.max(lng, c * CELL_DEG - 180), (c + 1) * CELL_DEG - 180);
      if (haversineMeters({ lat, lng }, { lat: nearLat, lng: nearLng }) <= reach) out.push(r * LNG_STRIDE + c);
    }
  }
  return out;
}

/** Sorted, de-duplicated cells merged into inclusive [first, last] runs of consecutive numbers (a run is part of one grid row, or runs on into the next row's start only if the numbers are consecutive, which is still exact). */
export function cellRuns(cells: readonly number[]): [number, number][] {
  const sorted = [...new Set(cells)].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const cell of sorted) {
    const last = runs[runs.length - 1];
    if (last && cell === last[1] + 1) last[1] = cell;
    else runs.push([cell, cell]);
  }
  return runs;
}

/**
 * Every cell a corridor polygon touches: its outline is walked in small steps, and the inside is filled row by row (a long
 * route's corridor can be wider than a cell, and cells wholly inside it must not be skipped).
 */
export function cellsForRing(ring: readonly LngLat[]): number[] {
  const cells = new Set<number>();
  const step = CELL_DEG / 5;
  for (let i = 0; i < ring.length; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[(i + 1) % ring.length];
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(lng2 - lng1), Math.abs(lat2 - lat1)) / step));
    for (let k = 0; k <= n; k++) cells.add(cellOf(lat1 + ((lat2 - lat1) * k) / n, lng1 + ((lng2 - lng1) * k) / n));
  }
  if (ring.length >= 3) {
    const lats = ring.map((p) => p[1]);
    const row0 = Math.floor((Math.min(...lats) + 90) / CELL_DEG);
    const row1 = Math.floor((Math.max(...lats) + 90) / CELL_DEG);
    for (let r = row0; r <= row1; r++) {
      const y = (r + 0.5) * CELL_DEG - 90; // the middle of the cell row
      const xs: number[] = [];
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > y !== yj > y) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.floor((xs[k] + 180) / CELL_DEG);
        const c1 = Math.floor((xs[k + 1] + 180) / CELL_DEG);
        for (let c = c0; c <= c1; c++) cells.add(r * LNG_STRIDE + c);
      }
    }
  }
  return [...cells];
}

/**
 * Same answer as `pointInRing`, built for testing many points against one ring: a bounding-box reject, then only the edges
 * that span the point's latitude strip are ray-cast (a corridor ring has hundreds of edges, a point touches a handful).
 */
export function createRingTester(ring: readonly LngLat[]): (lng: number, lat: number) => boolean {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const strips = Math.max(1, Math.min(256, ring.length));
  const span = maxY - minY || 1;
  const stripOf = (y: number) => Math.min(strips - 1, Math.max(0, Math.floor(((y - minY) / span) * strips)));
  const edges: number[][] = Array.from({ length: strips }, () => []);
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const lo = stripOf(Math.min(ring[i][1], ring[j][1]));
    const hi = stripOf(Math.max(ring[i][1], ring[j][1]));
    for (let s = lo; s <= hi; s++) edges[s].push(i, j);
  }
  return (lng, lat) => {
    if (!(lng >= minX && lng <= maxX && lat >= minY && lat <= maxY)) return false;
    const list = edges[stripOf(lat)];
    let inside = false;
    for (let k = 0; k < list.length; k += 2) {
      const [xi, yi] = ring[list[k]];
      const [xj, yj] = ring[list[k + 1]];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
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
