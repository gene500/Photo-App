import type { LngLat } from "@/lib/types";

/**
 * Finds the walk to a point of interest through a pile of trail line segments (from NPS or OpenStreetMap): the
 * segments are stitched into a graph (ends that nearly touch are joined, a trail that ends on the side of another
 * splits it there), the point is snapped onto the nearest trail, and a shortest path leads from the nearest
 * trailhead to it. Everything runs in a flat metre grid around the point, which is exact enough for a few km.
 */

export type HikePath = { coords: LngLat[]; distanceMeters: number };

export type FindOptions = {
  /**
   * Trailhead candidates in priority order (for example OSM trailheads, then parking lots). The nearest reachable one
   * of the first tier that has any is the start. With none reachable the nearest dead end of the trail network is used.
   */
  trailheadTiers?: LngLat[][];
  /** Trail ends closer than this are one junction. */
  joinM?: number;
  /** A trail end this close to the side of another trail is joined to it. */
  tJoinM?: number;
  /** The point must be this close to a trail. */
  snapPoiM?: number;
  /** A trailhead must be this close to a trail to count. */
  snapTrailheadM?: number;
  /** A walk shorter than this is "you are at the trailhead": no hike. */
  minM?: number;
  /** A walk longer than this is not offered. */
  maxM?: number;
  /** Segments with more vertices than this in total are ignored (a runaway answer). */
  maxVertices?: number;
};

const DEFAULTS = { joinM: 6, tJoinM: 8, snapPoiM: 300, snapTrailheadM: 150, minM: 120, maxM: 30_000, maxVertices: 40_000 };
const M_PER_DEG = 111_320;

type Frame = { lng0: number; lat0: number; kx: number };
const frameAt = (lat: number, lng: number): Frame => ({ lng0: lng, lat0: lat, kx: Math.cos((lat * Math.PI) / 180) * M_PER_DEG });
const toXY = (f: Frame, lng: number, lat: number): [number, number] => [(lng - f.lng0) * f.kx, (lat - f.lat0) * M_PER_DEG];
const toLngLat = (f: Frame, x: number, y: number): LngLat => [f.lng0 + x / f.kx, f.lat0 + y / M_PER_DEG];

/** Great-circle length of a line in metres. */
export function lineLengthMeters(coords: readonly LngLat[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversine(coords[i - 1], coords[i]);
  return total;
}

function haversine([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** Distance from (px,py) to segment a-b, with the nearest point and its fraction along the segment. */
function project(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return { t, x, y, d: Math.hypot(px - x, py - y) };
}

type Edge = { a: number; b: number; alive: boolean };

class Graph {
  xs: number[] = [];
  ys: number[] = [];
  edges: Edge[] = [];
  private cells = new Map<string, number[]>();
  private edgeKeys = new Set<string>();
  constructor(private joinM: number) {}

  private cellKey(x: number, y: number): string {
    return `${Math.floor(x / this.joinM)},${Math.floor(y / this.joinM)}`;
  }

  /** The node within joinM of the point, or a new one. */
  node(x: number, y: number): number {
    const cx = Math.floor(x / this.joinM);
    const cy = Math.floor(y / this.joinM);
    let best = -1;
    let bestD = this.joinM;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const n of this.cells.get(`${cx + i},${cy + j}`) ?? []) {
          const d = Math.hypot(this.xs[n] - x, this.ys[n] - y);
          if (d <= bestD) {
            best = n;
            bestD = d;
          }
        }
      }
    }
    if (best >= 0) return best;
    const id = this.xs.length;
    this.xs.push(x);
    this.ys.push(y);
    const key = this.cellKey(x, y);
    const list = this.cells.get(key);
    if (list) list.push(id);
    else this.cells.set(key, [id]);
    return id;
  }

  edge(a: number, b: number): void {
    if (a === b) return;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (this.edgeKeys.has(key)) return;
    this.edgeKeys.add(key);
    this.edges.push({ a, b, alive: true });
  }

  /** Cuts edge `i` at node `n` (no-op when `n` is one of its ends). */
  split(i: number, n: number): void {
    const e = this.edges[i];
    if (n === e.a || n === e.b) return;
    e.alive = false;
    this.edge(e.a, n);
    this.edge(n, e.b);
  }

  degrees(): number[] {
    const deg = new Array<number>(this.xs.length).fill(0);
    for (const e of this.edges) {
      if (!e.alive) continue;
      deg[e.a]++;
      deg[e.b]++;
    }
    return deg;
  }

  /** Nearest alive edge to the point, skipping edges that touch `skipNode`. */
  nearestEdge(x: number, y: number, skipNode = -1): { index: number; x: number; y: number; d: number } | null {
    let best: { index: number; x: number; y: number; d: number } | null = null;
    this.edges.forEach((e, index) => {
      if (!e.alive || e.a === skipNode || e.b === skipNode) return;
      const p = project(x, y, this.xs[e.a], this.ys[e.a], this.xs[e.b], this.ys[e.b]);
      if (!best || p.d < best.d) best = { index, x: p.x, y: p.y, d: p.d };
    });
    return best;
  }

  /** Puts the point onto the nearest trail (splitting it) if within `maxM`; returns the node there. */
  snap(x: number, y: number, maxM: number): number | null {
    const hit = this.nearestEdge(x, y);
    if (!hit || hit.d > maxM) return null;
    const n = this.node(hit.x, hit.y);
    this.split(hit.index, n);
    return n;
  }
}

class MinHeap {
  private items: [number, number][] = []; // [distance, node]
  get size() {
    return this.items.length;
  }
  push(d: number, n: number) {
    const a = this.items;
    a.push([d, n]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Douglas-Peucker in the flat grid: points within `tolM` of the straight run are dropped. */
function simplify(pts: [number, number][], tolM: number): [number, number][] {
  if (pts.length <= 2) return pts;
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let worst = -1;
    let worstD = tolM;
    for (let i = s + 1; i < e; i++) {
      const d = project(pts[i][0], pts[i][1], pts[s][0], pts[s][1], pts[e][0], pts[e][1]).d;
      if (d > worstD) {
        worst = i;
        worstD = d;
      }
    }
    if (worst >= 0) {
      keep[worst] = true;
      stack.push([s, worst], [worst, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** A line with at most `cap` points (about 2 m of detail first, coarser until it fits), coordinates to 5 decimals (~1 m). */
export function simplifyLine(coords: LngLat[], cap: number, around: { lat: number; lng: number }): LngLat[] {
  const f = frameAt(around.lat, around.lng);
  const xy = coords.map(([lng, lat]) => toXY(f, lng, lat));
  let tol = 2;
  let out = simplify(xy, tol);
  while (out.length > cap && tol < 1000) {
    tol *= 1.6;
    out = simplify(xy, tol);
  }
  const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
  return out.map(([x, y]) => {
    const [lng, lat] = toLngLat(f, x, y);
    return [r5(lng), r5(lat)] as LngLat;
  });
}

/**
 * The walk from the nearest trailhead to `poi` along the stitched trails, or null when the point is not near a trail,
 * no start is reachable, or the walk is shorter than `minM` (the point is at the trailhead).
 */
export function findHikePath(segments: readonly (readonly LngLat[])[], poi: { lat: number; lng: number }, options: FindOptions = {}): HikePath | null {
  const o = { ...DEFAULTS, ...options };
  const f = frameAt(poi.lat, poi.lng);
  let vertices = 0;
  for (const s of segments) vertices += s.length;
  if (vertices > o.maxVertices) return null;

  const g = new Graph(o.joinM);
  const ends: number[] = [];
  for (const seg of segments) {
    if (seg.length < 2) continue;
    let prev = -1;
    seg.forEach(([lng, lat], i) => {
      const [x, y] = toXY(f, lng, lat);
      const n = g.node(x, y);
      if (prev >= 0) g.edge(prev, n);
      if (i === 0 || i === seg.length - 1) ends.push(n);
      prev = n;
    });
  }
  if (g.edges.length === 0) return null;

  // A trail that ends on the side of another (no shared vertex) joins it there.
  const deg0 = g.degrees();
  for (const n of new Set(ends)) {
    if (deg0[n] !== 1) continue;
    const hit = g.nearestEdge(g.xs[n], g.ys[n], n);
    if (hit && hit.d <= o.tJoinM) {
      const j = g.node(hit.x, hit.y);
      g.split(hit.index, j);
      g.edge(n, j);
    }
  }

  const [px, py] = toXY(f, poi.lng, poi.lat);
  const poiNode = g.snap(px, py, o.snapPoiM);
  if (poiNode === null) return null;

  const tiers: number[][] = [];
  for (const tier of options.trailheadTiers ?? []) {
    const nodes: number[] = [];
    for (const [lng, lat] of tier) {
      const [x, y] = toXY(f, lng, lat);
      const n = g.snap(x, y, o.snapTrailheadM);
      if (n !== null) nodes.push(n);
    }
    if (nodes.length) tiers.push(nodes);
  }
  const deg = g.degrees();
  const deadEnds: number[] = [];
  deg.forEach((d, n) => {
    if (d === 1 && n !== poiNode) deadEnds.push(n);
  });

  // Shortest paths from the point.
  const adj: [number, number][][] = Array.from({ length: g.xs.length }, () => []);
  for (const e of g.edges) {
    if (!e.alive) continue;
    const w = Math.hypot(g.xs[e.a] - g.xs[e.b], g.ys[e.a] - g.ys[e.b]);
    adj[e.a].push([e.b, w]);
    adj[e.b].push([e.a, w]);
  }
  const dist = new Array<number>(g.xs.length).fill(Infinity);
  const prev = new Array<number>(g.xs.length).fill(-1);
  dist[poiNode] = 0;
  const heap = new MinHeap();
  heap.push(0, poiNode);
  while (heap.size) {
    const [d, n] = heap.pop();
    if (d > dist[n]) continue;
    if (d > o.maxM) break;
    for (const [m, w] of adj[n]) {
      if (d + w < dist[m]) {
        dist[m] = d + w;
        prev[m] = n;
        heap.push(d + w, m);
      }
    }
  }

  const reachable = (nodes: number[]) => nodes.filter((n) => Number.isFinite(dist[n]) && dist[n] <= o.maxM);
  let start = -1;
  for (const tier of tiers) {
    const near = reachable(tier);
    if (near.length === 0) continue;
    start = near.reduce((a, b) => (dist[b] < dist[a] ? b : a));
    // A trailhead right at the point: the place is the trailhead, there is no hike to speak of.
    if (dist[start] < o.minM) return null;
    break;
  }
  if (start < 0) {
    const far = reachable(deadEnds).filter((n) => dist[n] >= o.minM);
    if (far.length === 0) return null;
    start = far.reduce((a, b) => (dist[b] < dist[a] ? b : a));
  }

  const nodes: number[] = [];
  for (let n = start; n >= 0; n = prev[n]) nodes.push(n); // start ... poiNode
  const coords = nodes.map((n) => toLngLat(f, g.xs[n], g.ys[n]));
  return { coords, distanceMeters: lineLengthMeters(coords) };
}
