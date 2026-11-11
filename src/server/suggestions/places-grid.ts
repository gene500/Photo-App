import { haversineMeters } from "@/lib/geo";
import type { LngLat } from "@/lib/types";

/** Places are bucketed into 0.1 degree squares (about 11 km), so a search reads a handful of index ranges instead of scanning. */
const CELL_DEG = 0.1;
const LNG_STRIDE = 10_000;
const COLS = Math.round(360 / CELL_DEG);

/** Wraps a grid column across the antimeridian into 0..COLS-1. */
const wrapCol = (c: number) => ((c % COLS) + COLS) % COLS;

/** Longitude 180 (or a hair under it that rounds up) wraps to column 0 with -180, the column every search looks it up in. */
export function cellOf(lat: number, lng: number): number {
  return Math.floor((lat + 90) / CELL_DEG) * LNG_STRIDE + wrapCol(Math.floor((lng + 180) / CELL_DEG));
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
  const col1 = Math.min(Math.floor((lng + dLng + 180) / CELL_DEG), col0 + COLS - 1);
  // A little slack (1 % + 300 m) keeps this conservative: the box maths and haversine differ slightly, and a cell must never be missed.
  const reach = radiusKm * 1010 + 300;
  for (let r = row0; r <= row1; r++) {
    const nearLat = Math.min(Math.max(lat, r * CELL_DEG - 90), (r + 1) * CELL_DEG - 90);
    for (let c = col0; c <= col1; c++) {
      const nearLng = Math.min(Math.max(lng, c * CELL_DEG - 180), (c + 1) * CELL_DEG - 180);
      if (haversineMeters({ lat, lng }, { lat: nearLat, lng: nearLng }) <= reach) out.push(r * LNG_STRIDE + wrapCol(c));
    }
  }
  return out;
}

/** Sorted, de-duplicated cells merged into inclusive [first, last] runs of consecutive numbers (a run is part of one grid row, or runs on into the next row's start only if the numbers are consecutive, which is still exact). */
export function cellRuns(cells: readonly number[]): [number, number][] {
  // A typed-array sort is numeric and several times faster than a comparator sort of a de-duplicated Set (same order, same runs).
  const sorted = Float64Array.from(cells).sort();
  const runs: [number, number][] = [];
  let prev = NaN;
  for (let i = 0; i < sorted.length; i++) {
    const cell = sorted[i];
    if (cell === prev) continue;
    prev = cell;
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
export function cellsForRing(ring: readonly LngLat[], holes: readonly (readonly LngLat[])[] = []): number[] {
  const cells = new Set<number>();
  const step = CELL_DEG / 5;
  const all = [ring, ...holes];
  for (const r of all) {
    const len = r.length;
    for (let i = 0; i < len; i++) {
      const p = r[i];
      const q = r[(i + 1) % len];
      const lng1 = p[0], lat1 = p[1], lng2 = q[0], lat2 = q[1];
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(lng2 - lng1), Math.abs(lat2 - lat1)) / step));
      for (let k = 0; k <= n; k++) cells.add(Math.floor((lat1 + ((lat2 - lat1) * k) / n + 90) / CELL_DEG) * LNG_STRIDE + wrapCol(Math.floor((lng1 + ((lng2 - lng1) * k) / n + 180) / CELL_DEG)));
    }
  }
  if (ring.length >= 3) {
    let minLat = Infinity, maxLat = -Infinity;
    for (let i = 0; i < ring.length; i++) {
      const y = ring[i][1];
      if (y !== y) { minLat = NaN; maxLat = NaN; break; } // Math.min / Math.max of a NaN is NaN
      if (y < minLat) minLat = y;
      if (y > maxLat) maxLat = y;
    }
    const row0 = Math.floor((minLat + 90) / CELL_DEG);
    const row1 = Math.floor((maxLat + 90) / CELL_DEG);
    const xs: number[] = [];
    for (let r = row0; r <= row1; r++) {
      const y = (r + 0.5) * CELL_DEG - 90; // the middle of the cell row
      xs.length = 0;
      // Even-odd across the outer ring and the holes together: the spans between a hole's edges are left unfilled.
      for (const rr of all) {
        for (let i = 0, j = rr.length - 1; i < rr.length; j = i++) {
          const pi = rr[i], pj = rr[j];
          const xi = pi[0], yi = pi[1], xj = pj[0], yj = pj[1];
          if (yi > y !== yj > y) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.floor((xs[k] + 180) / CELL_DEG);
        const c1 = Math.min(Math.floor((xs[k + 1] + 180) / CELL_DEG), c0 + COLS - 1);
        const rowBase = r * LNG_STRIDE;
        for (let c = c0; c <= c1; c++) cells.add(rowBase + wrapCol(c));
      }
    }
  }
  return [...cells];
}

/**
 * Same answer as `pointInRing` (and not inside any of `holes`), built for testing many points against one ring: a bounding-box reject, then only the edges
 * that span the point's latitude strip are ray-cast (a corridor ring has hundreds of edges, a point touches a handful).
 */
export function createRingTester(ring: readonly LngLat[], holes: readonly (readonly LngLat[])[] = []): (lng: number, lat: number) => boolean {
  const outer = createSingleRingTester(ring);
  if (holes.length === 0) return outer;
  const inHole = holes.map(createSingleRingTester);
  return (lng, lat) => outer(lng, lat) && !inHole.some((h) => h(lng, lat));
}

/** Below this many vertices the typed-array build costs more than it saves; the plain version is used. */
const TYPED_TESTER_MIN_POINTS = 32;

function createSingleRingTester(ring: readonly LngLat[]): (lng: number, lat: number) => boolean {
  return ring.length >= TYPED_TESTER_MIN_POINTS ? createTypedRingTester(ring) : createSmallRingTester(ring);
}

/** Same edges per latitude strip, in the same order, held in typed arrays (flat, no tuple destructuring per edge test). */
function createTypedRingTester(ring: readonly LngLat[]): (lng: number, lat: number) => boolean {
  const n = ring.length;
  const X = new Float64Array(n);
  const Y = new Float64Array(n);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = ring[i][0], y = ring[i][1];
    X[i] = x;
    Y[i] = y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const strips = Math.max(1, Math.min(256, n));
  const span = maxY - minY || 1;
  const stripOf = (y: number) => Math.min(strips - 1, Math.max(0, Math.floor(((y - minY) / span) * strips)));
  // Compressed rows: the edges of strip s are EI/EJ[start[s] .. start[s + 1]).
  const start = new Int32Array(strips + 1);
  const bounds = new Int32Array(2 * n);
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const lo = stripOf(Math.min(Y[i], Y[j]));
    const hi = stripOf(Math.max(Y[i], Y[j]));
    bounds[2 * i] = lo;
    bounds[2 * i + 1] = hi;
    for (let s = lo; s <= hi; s++) start[s + 1]++;
  }
  for (let s = 0; s < strips; s++) start[s + 1] += start[s];
  const fill = start.slice(0, strips);
  const EI = new Int32Array(start[strips]);
  const EJ = new Int32Array(start[strips]);
  for (let i = 0, j = n - 1; i < n; j = i++) {
    for (let s = bounds[2 * i]; s <= bounds[2 * i + 1]; s++) {
      const slot = fill[s]++;
      EI[slot] = i;
      EJ[slot] = j;
    }
  }
  return (lng, lat) => {
    if (!(lng >= minX && lng <= maxX && lat >= minY && lat <= maxY)) return false;
    const s = stripOf(lat);
    let inside = false;
    for (let k = start[s], end = start[s + 1]; k < end; k++) {
      const i = EI[k], j = EJ[k];
      const xi = X[i], yi = Y[i], xj = X[j], yj = Y[j];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
}

function createSmallRingTester(ring: readonly LngLat[]): (lng: number, lat: number) => boolean {
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
