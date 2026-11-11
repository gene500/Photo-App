import type { LngLat } from "@/lib/types";
import * as base from "../baseline/places-grid";

const CELL_DEG = 0.1;
const LNG_STRIDE = 10_000;
const COLS = Math.round(360 / CELL_DEG);
const wrapCol = (c: number) => ((c % COLS) + COLS) % COLS;
const KM_PER_DEG = 111.32;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** A: haversine inlined; row trig hoisted; per-column trig precomputed. Same float expressions as geo.haversineMeters. */
export function circleA(lat: number, lng: number, radiusKm: number): number[] {
  const dLat = radiusKm / KM_PER_DEG;
  const dLng = radiusKm / (KM_PER_DEG * Math.max(Math.cos((lat * Math.PI) / 180), 0.05));
  const out: number[] = [];
  const row0 = Math.floor((lat - dLat + 90) / CELL_DEG);
  const row1 = Math.floor((lat + dLat + 90) / CELL_DEG);
  const col0 = Math.floor((lng - dLng + 180) / CELL_DEG);
  const col1 = Math.min(Math.floor((lng + dLng + 180) / CELL_DEG), col0 + COLS - 1);
  const reach = radiusKm * 1010 + 300;
  const cosA = Math.cos(toRad(lat));
  const ncol = col1 - col0 + 1;
  const wrapped = new Array<number>((ncol > 0 ? ncol : 0));
  const sLng = new Array<number>((ncol > 0 ? ncol : 0));
  for (let c = col0; c <= col1; c++) {
    const nearLng = Math.min(Math.max(lng, c * CELL_DEG - 180), (c + 1) * CELL_DEG - 180);
    wrapped[c - col0] = wrapCol(c);
    sLng[c - col0] = Math.sin(toRad(nearLng - lng) / 2) ** 2;
  }
  for (let r = row0; r <= row1; r++) {
    const nearLat = Math.min(Math.max(lat, r * CELL_DEG - 90), (r + 1) * CELL_DEG - 90);
    const sLat = Math.sin(toRad(nearLat - lat) / 2) ** 2;
    const cc = cosA * Math.cos(toRad(nearLat));
    const rowBase = r * LNG_STRIDE;
    for (let k = 0; k < ncol; k++) {
      const h = sLat + cc * sLng[k];
      if (2 * 6_371_000 * Math.asin(Math.sqrt(h)) <= reach) out.push(rowBase + wrapped[k]);
    }
  }
  return out;
}

/** B: A plus a cheap reject: a cell whose nearest-point latitude gap alone exceeds reach (R*dLat, with 2x margin on the cutoff) is skipped without trig. */
export function circleB(lat: number, lng: number, radiusKm: number): number[] {
  const dLat = radiusKm / KM_PER_DEG;
  const dLng = radiusKm / (KM_PER_DEG * Math.max(Math.cos((lat * Math.PI) / 180), 0.05));
  const out: number[] = [];
  const row0 = Math.floor((lat - dLat + 90) / CELL_DEG);
  const row1 = Math.floor((lat + dLat + 90) / CELL_DEG);
  const col0 = Math.floor((lng - dLng + 180) / CELL_DEG);
  const col1 = Math.min(Math.floor((lng + dLng + 180) / CELL_DEG), col0 + COLS - 1);
  const reach = radiusKm * 1010 + 300;
  const cosA = Math.cos(toRad(lat));
  const ncol = col1 - col0 + 1;
  const wrapped = new Float64Array((ncol > 0 ? ncol : 0));
  const sLng = new Float64Array((ncol > 0 ? ncol : 0));
  const nl = new Float64Array((ncol > 0 ? ncol : 0));
  for (let c = col0; c <= col1; c++) {
    const nearLng = Math.min(Math.max(lng, c * CELL_DEG - 180), (c + 1) * CELL_DEG - 180);
    nl[c - col0] = nearLng - lng;
    wrapped[c - col0] = wrapCol(c);
    sLng[c - col0] = Math.sin(toRad(nearLng - lng) / 2) ** 2;
  }
  // 2R*asin(sqrt(h)) >= 2R*asin(sqrt(sLat)) = R*|dLat| (exact math): when that exceeds reach by 1 % the cell is out for sure; the 1 % covers float error.
  const cutoffRad = (reach * 1.01) / 6_371_000;
  for (let r = row0; r <= row1; r++) {
    const nearLat = Math.min(Math.max(lat, r * CELL_DEG - 90), (r + 1) * CELL_DEG - 90);
    const dl = toRad(nearLat - lat);
    if (Math.abs(dl) > cutoffRad) continue;
    const sLat = Math.sin(dl / 2) ** 2;
    const cc = cosA * Math.cos(toRad(nearLat));
    const rowBase = r * LNG_STRIDE;
    for (let k = 0; k < ncol; k++) {
      const h = sLat + cc * sLng[k];
      if (2 * 6_371_000 * Math.asin(Math.sqrt(h)) <= reach) out.push(rowBase + wrapped[k]);
    }
  }
  return out;
}

/** C: A's loop but compares h to a precomputed threshold (sin^2(reach/2R)) with a guard band, calling asin only near the boundary. */
export function circleC(lat: number, lng: number, radiusKm: number): number[] {
  const dLat = radiusKm / KM_PER_DEG;
  const dLng = radiusKm / (KM_PER_DEG * Math.max(Math.cos((lat * Math.PI) / 180), 0.05));
  const out: number[] = [];
  const row0 = Math.floor((lat - dLat + 90) / CELL_DEG);
  const row1 = Math.floor((lat + dLat + 90) / CELL_DEG);
  const col0 = Math.floor((lng - dLng + 180) / CELL_DEG);
  const col1 = Math.min(Math.floor((lng + dLng + 180) / CELL_DEG), col0 + COLS - 1);
  const reach = radiusKm * 1010 + 300;
  const cosA = Math.cos(toRad(lat));
  const ncol = col1 - col0 + 1;
  const wrapped = new Array<number>((ncol > 0 ? ncol : 0));
  const sLng = new Array<number>((ncol > 0 ? ncol : 0));
  for (let c = col0; c <= col1; c++) {
    const nearLng = Math.min(Math.max(lng, c * CELL_DEG - 180), (c + 1) * CELL_DEG - 180);
    wrapped[c - col0] = wrapCol(c);
    sLng[c - col0] = Math.sin(toRad(nearLng - lng) / 2) ** 2;
  }
  const t = Math.sin(reach / (2 * 6_371_000)) ** 2;
  const lo = t * (1 - 1e-9), hi = t * (1 + 1e-9);
  const exact = !(t >= 0 && t < 1);
  for (let r = row0; r <= row1; r++) {
    const nearLat = Math.min(Math.max(lat, r * CELL_DEG - 90), (r + 1) * CELL_DEG - 90);
    const sLat = Math.sin(toRad(nearLat - lat) / 2) ** 2;
    const cc = cosA * Math.cos(toRad(nearLat));
    const rowBase = r * LNG_STRIDE;
    for (let k = 0; k < ncol; k++) {
      const h = sLat + cc * sLng[k];
      if (!exact && h < lo) out.push(rowBase + wrapped[k]);
      else if (!exact && h > hi) continue;
      else if (2 * 6_371_000 * Math.asin(Math.sqrt(h)) <= reach) out.push(rowBase + wrapped[k]);
    }
  }
  return out;
}

/** cellRuns A: typed-array numeric sort, then dedupe + merge in one pass. */
export function runsA(cells: readonly number[]): [number, number][] {
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
/** cellRuns B: sort in place on a copy (no Set), Array sort. */
export function runsB(cells: readonly number[]): [number, number][] {
  const sorted = cells.slice().sort((a, b) => a - b);
  const runs: [number, number][] = [];
  let lastCell = NaN;
  for (let i = 0; i < sorted.length; i++) {
    const cell = sorted[i];
    if (cell === lastCell) continue;
    lastCell = cell;
    const last = runs[runs.length - 1];
    if (last && cell === last[1] + 1) last[1] = cell;
    else runs.push([cell, cell]);
  }
  return runs;
}
/** cellRuns C: Set dedupe kept (as baseline) but typed sort. */
export function runsC(cells: readonly number[]): [number, number][] {
  const sorted = Float64Array.from(new Set(cells)).sort();
  const runs: [number, number][] = [];
  for (let i = 0; i < sorted.length; i++) {
    const cell = sorted[i];
    const last = runs[runs.length - 1];
    if (last && cell === last[1] + 1) last[1] = cell;
    else runs.push([cell, cell]);
  }
  return runs;
}

type Ring = readonly LngLat[];

/** ring A: same algorithm, flat loops without destructuring/spread, reused xs array. */
export function ringA(ring: Ring, holes: readonly Ring[] = []): number[] {
  const cells = new Set<number>();
  const step = CELL_DEG / 5;
  const all = [ring, ...holes];
  for (const r of all) {
    const len = r.length;
    for (let i = 0; i < len; i++) {
      const p = r[i], q = r[(i + 1) % len];
      const lng1 = p[0], lat1 = p[1], lng2 = q[0], lat2 = q[1];
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(lng2 - lng1), Math.abs(lat2 - lat1)) / step));
      for (let k = 0; k <= n; k++) cells.add(Math.floor((lat1 + ((lat2 - lat1) * k) / n + 90) / CELL_DEG) * LNG_STRIDE + wrapCol(Math.floor((lng1 + ((lng2 - lng1) * k) / n + 180) / CELL_DEG)));
    }
  }
  if (ring.length >= 3) {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < ring.length; i++) { const y = ring[i][1]; if (y < mn) mn = y; if (y > mx) mx = y; }
    // Math.min(...lats) with NaN gives NaN; mimic
    for (let i = 0; i < ring.length; i++) if (ring[i][1] !== ring[i][1]) { mn = NaN; mx = NaN; break; }
    const row0 = Math.floor((mn + 90) / CELL_DEG);
    const row1 = Math.floor((mx + 90) / CELL_DEG);
    const xs: number[] = [];
    for (let r = row0; r <= row1; r++) {
      const y = (r + 0.5) * CELL_DEG - 90;
      xs.length = 0;
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

/** ring B: A, with the outline cells collected by an Int32 open-addressing hash set that remembers insertion order (falls back when input is non-finite). */
export function ringB(ring: Ring, holes: readonly Ring[] = []): number[] {
  const all = [ring, ...holes];
  for (const r of all) for (let i = 0; i < r.length; i++) if (!Number.isFinite(r[i][0]) || !Number.isFinite(r[i][1])) return base.cellsForRing(ring, holes);
  let cap = 1024;
  let table = new Int32Array(cap).fill(-1); // index into order
  let order = new Float64Array(1024);
  let size = 0;
  const add = (v: number) => {
    if (size * 2 >= cap) {
      cap *= 2;
      const nt = new Int32Array(cap).fill(-1);
      for (let i = 0; i < size; i++) {
        let h = (Math.imul(order[i] | 0, 0x9e3779b1) >>> 0) & (cap - 1);
        while (nt[h] !== -1) h = (h + 1) & (cap - 1);
        nt[h] = i;
      }
      table = nt;
    }
    let h = (Math.imul(v | 0, 0x9e3779b1) >>> 0) & (cap - 1);
    for (;;) {
      const e = table[h];
      if (e === -1) break;
      if (order[e] === v) return;
      h = (h + 1) & (cap - 1);
    }
    if (size === order.length) { const no = new Float64Array(size * 2); no.set(order); order = no; }
    order[size] = v;
    table[h] = size++;
  };
  const step = CELL_DEG / 5;
  for (const r of all) {
    const len = r.length;
    for (let i = 0; i < len; i++) {
      const p = r[i], q = r[(i + 1) % len];
      const lng1 = p[0], lat1 = p[1], lng2 = q[0], lat2 = q[1];
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(lng2 - lng1), Math.abs(lat2 - lat1)) / step));
      for (let k = 0; k <= n; k++) add(Math.floor((lat1 + ((lat2 - lat1) * k) / n + 90) / CELL_DEG) * LNG_STRIDE + wrapCol(Math.floor((lng1 + ((lng2 - lng1) * k) / n + 180) / CELL_DEG)));
    }
  }
  if (ring.length >= 3) {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < ring.length; i++) { const y = ring[i][1]; if (y < mn) mn = y; if (y > mx) mx = y; }
    const row0 = Math.floor((mn + 90) / CELL_DEG);
    const row1 = Math.floor((mx + 90) / CELL_DEG);
    const xs: number[] = [];
    for (let r = row0; r <= row1; r++) {
      const y = (r + 0.5) * CELL_DEG - 90;
      xs.length = 0;
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
        for (let c = c0; c <= c1; c++) add(rowBase + wrapCol(c));
      }
    }
  }
  return Array.from(order.subarray(0, size));
}

/** ring C: A, but the row fill runs the whole sweep with one pre-bucketed edge list per row (edges sorted by min lat), avoiding scanning every edge per row. */
export function ringC(ring: Ring, holes: readonly Ring[] = []): number[] {
  const all = [ring, ...holes];
  for (const r of all) for (let i = 0; i < r.length; i++) if (!Number.isFinite(r[i][0]) || !Number.isFinite(r[i][1])) return base.cellsForRing(ring, holes);
  const cells = new Set<number>();
  const step = CELL_DEG / 5;
  for (const r of all) {
    const len = r.length;
    for (let i = 0; i < len; i++) {
      const p = r[i], q = r[(i + 1) % len];
      const lng1 = p[0], lat1 = p[1], lng2 = q[0], lat2 = q[1];
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(lng2 - lng1), Math.abs(lat2 - lat1)) / step));
      for (let k = 0; k <= n; k++) cells.add(Math.floor((lat1 + ((lat2 - lat1) * k) / n + 90) / CELL_DEG) * LNG_STRIDE + wrapCol(Math.floor((lng1 + ((lng2 - lng1) * k) / n + 180) / CELL_DEG)));
    }
  }
  if (ring.length >= 3) {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < ring.length; i++) { const y = ring[i][1]; if (y < mn) mn = y; if (y > mx) mx = y; }
    const row0 = Math.floor((mn + 90) / CELL_DEG);
    const row1 = Math.floor((mx + 90) / CELL_DEG);
    // edges as flat arrays
    const ex: number[] = [], ey: number[] = [], fx: number[] = [], fy: number[] = [];
    for (const rr of all) for (let i = 0, j = rr.length - 1; i < rr.length; j = i++) { ex.push(rr[i][0]); ey.push(rr[i][1]); fx.push(rr[j][0]); fy.push(rr[j][1]); }
    const m = ex.length;
    const nrows = row1 - row0 + 1;
    if (nrows >= 1e6) return base.cellsForRing(ring, holes);
    if (nrows > 0) {
      // per row: edge indices (in original order) whose y span crosses the row's mid-line
      const rowEdges: number[][] = Array.from({ length: nrows }, () => []);
      for (let e = 0; e < m; e++) {
        const lo = Math.min(ey[e], fy[e]), hi = Math.max(ey[e], fy[e]);
        if (lo === hi) continue;
        let a = Math.floor((lo + 90) / CELL_DEG) - 2, b = Math.floor((hi + 90) / CELL_DEG) + 2;
        if (a < row0) a = row0;
        if (b > row1) b = row1;
        for (let r = a; r <= b; r++) rowEdges[r - row0].push(e);
      }
      const xs: number[] = [];
      for (let r = row0; r <= row1; r++) {
        const y = (r + 0.5) * CELL_DEG - 90;
        xs.length = 0;
        const list = rowEdges[r - row0];
        for (let t = 0; t < list.length; t++) {
          const e = list[t];
          const yi = ey[e], yj = fy[e];
          if (yi > y !== yj > y) xs.push(ex[e] + ((y - yi) * (fx[e] - ex[e])) / (yj - yi));
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
  }
  return [...cells];
}

type Tester = (lng: number, lat: number) => boolean;
function singleA(ring: Ring): Tester {
  const n = ring.length;
  const X = new Float64Array(n), Y = new Float64Array(n);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = ring[i][0], y = ring[i][1];
    X[i] = x; Y[i] = y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const strips = Math.max(1, Math.min(256, n));
  const span = maxY - minY || 1;
  const stripOf = (y: number) => Math.min(strips - 1, Math.max(0, Math.floor(((y - minY) / span) * strips)));
  // CSR: for each strip a run of edge ends (i, j) in the same order the baseline pushes them.
  const count = new Int32Array(strips + 1);
  const lohi: number[] = [];
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const lo = stripOf(Math.min(Y[i], Y[j]));
    const hi = stripOf(Math.max(Y[i], Y[j]));
    lohi.push(lo, hi);
    for (let s = lo; s <= hi; s++) count[s + 1]++;
  }
  for (let s = 0; s < strips; s++) count[s + 1] += count[s];
  const fill = count.slice(0, strips);
  const EI = new Int32Array(count[strips]), EJ = new Int32Array(count[strips]);
  for (let i = 0, j = n - 1, q = 0; i < n; j = i++, q += 2) {
    for (let s = lohi[q]; s <= lohi[q + 1]; s++) { const p = fill[s]++; EI[p] = i; EJ[p] = j; }
  }
  return (lng, lat) => {
    if (!(lng >= minX && lng <= maxX && lat >= minY && lat <= maxY)) return false;
    const s = stripOf(lat);
    let inside = false;
    for (let k = count[s], e = count[s + 1]; k < e; k++) {
      const i = EI[k], j = EJ[k];
      const xi = X[i], yi = Y[i], xj = X[j], yj = Y[j];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
}
/** tester A: typed arrays + CSR strips. */
export function testerA(ring: Ring, holes: readonly Ring[] = []): Tester {
  const outer = singleA(ring);
  if (holes.length === 0) return outer;
  const inHole = holes.map(singleA);
  return (lng, lat) => {
    if (!outer(lng, lat)) return false;
    for (let i = 0; i < inHole.length; i++) if (inHole[i](lng, lat)) return false;
    return true;
  };
}

/** tester B: A, plus a per-ring uniform-latitude-strip fast path is not possible without changing results, so instead memoise strips as flat Float64 edge records (xi,yi,xj,yj contiguous). */
function singleB(ring: Ring): Tester {
  const n = ring.length;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = ring[i][0], y = ring[i][1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const strips = Math.max(1, Math.min(256, n));
  const span = maxY - minY || 1;
  const stripOf = (y: number) => Math.min(strips - 1, Math.max(0, Math.floor(((y - minY) / span) * strips)));
  const lists: number[][] = Array.from({ length: strips }, () => []);
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    const lo = stripOf(Math.min(yi, yj));
    const hi = stripOf(Math.max(yi, yj));
    for (let s = lo; s <= hi; s++) lists[s].push(xi, yi, xj, yj);
  }
  const flat = lists.map((l) => Float64Array.from(l));
  return (lng, lat) => {
    if (!(lng >= minX && lng <= maxX && lat >= minY && lat <= maxY)) return false;
    const L = flat[stripOf(lat)];
    let inside = false;
    for (let k = 0; k < L.length; k += 4) {
      const xi = L[k], yi = L[k + 1], xj = L[k + 2], yj = L[k + 3];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
}
export function testerB(ring: Ring, holes: readonly Ring[] = []): Tester {
  const outer = singleB(ring);
  if (holes.length === 0) return outer;
  const inHole = holes.map(singleB);
  return (lng, lat) => outer(lng, lat) && !inHole.some((h) => h(lng, lat));
}

/** tester C: plain ray cast on the whole ring after a bbox reject (no strips) — baseline for pointInRing with bbox. */
export function testerC(ring: Ring, holes: readonly Ring[] = []): Tester {
  const mk = (r: Ring): Tester => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of r) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    return (lng, lat) => {
      if (!(lng >= minX && lng <= maxX && lat >= minY && lat <= maxY)) return false;
      return base.pointInRing(lng, lat, r);
    };
  };
  const outer = mk(ring);
  const hs = holes.map(mk);
  return (lng, lat) => outer(lng, lat) && !hs.some((h) => h(lng, lat));
}
