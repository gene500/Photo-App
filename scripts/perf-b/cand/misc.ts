import * as baseFan from "../baseline/marker-fan";
import type { PlaceRow } from "../baseline/local-pure";
import { toElements as baseToElements } from "../baseline/local-pure";

type ScreenPoint = baseFan.ScreenPoint;
type Offset = baseFan.Offset;
const MARKER_PX = 32;

function build(points: ScreenPoint[], minDist: number, root: (i: number) => number): Map<string, Offset> {
  const groups = new Map<number, number[]>();
  for (let i = 0; i < points.length; i++) {
    const r = root(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  }
  const out = new Map<string, Offset>();
  for (const idx of groups.values()) {
    const n = idx.length;
    if (n < 2) continue;
    const cx = idx.reduce((s, i) => s + points[i].x, 0) / n;
    const cy = idx.reduce((s, i) => s + points[i].y, 0) / n;
    const radius = n === 2 ? minDist / 2 + 2 : (minDist + 2) / (2 * Math.sin(Math.PI / n));
    idx.forEach((i, k) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * k) / n;
      out.set(points[i].id, { dx: cx + radius * Math.cos(angle) - points[i].x, dy: cy + radius * Math.sin(angle) - points[i].y });
    });
  }
  return out;
}
const usable = (points: ScreenPoint[], minDist: number) => {
  if (!(Number.isFinite(minDist) && minDist > 0)) return false;
  for (const p of points) if (!(Math.abs(p.x) < 1e9 && Math.abs(p.y) < 1e9)) return false;
  return true;
};
function mkUF(n: number) {
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return parent[i]; };
  return { find, union: (a: number, b: number) => { parent[find(a)] = find(b); } };
}

/** A: only the group-building copy is fixed; pair loop is baseline all-pairs with hypot. */
export function fanA(points: ScreenPoint[], minDist = MARKER_PX): Map<string, Offset> {
  const uf = mkUF(points.length);
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) if (Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) < minDist) uf.union(i, j);
  return build(points, minDist, uf.find);
}
/** B: sort by x, sweep with |dx| window. */
export function fanB(points: ScreenPoint[], minDist = MARKER_PX): Map<string, Offset> {
  if (!usable(points, minDist)) return baseFan.fanOffsets(points, minDist);
  const n = points.length;
  const uf = mkUF(n);
  const X = new Float64Array(n), Y = new Float64Array(n);
  for (let i = 0; i < n; i++) { X[i] = points[i].x; Y[i] = points[i].y; }
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => X[a] - X[b]);
  const lim = minDist * (1 + 1e-9) + 1e-9;
  for (let p = 0; p < n; p++) {
    const i = order[p];
    for (let q = p + 1; q < n; q++) {
      const j = order[q];
      if (X[j] - X[i] > lim) break;
      if (Math.hypot(X[i] - X[j], Y[i] - Y[j]) < minDist) uf.union(i, j);
    }
  }
  return build(points, minDist, uf.find);
}
/** C: spatial hash grid with cell = minDist, check 3x3 neighbourhood. */
export function fanC(points: ScreenPoint[], minDist = MARKER_PX): Map<string, Offset> {
  if (!usable(points, minDist)) return baseFan.fanOffsets(points, minDist);
  const n = points.length;
  const uf = mkUF(n);
  const cell = minDist * (1 + 1e-6);
  const buckets = new Map<number, number[]>();
  const keyOf = (cx: number, cy: number) => cx * 4294967 + cy;
  const cxs = new Float64Array(n), cys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(points[i].x / cell), cy = Math.floor(points[i].y / cell);
    cxs[i] = cx; cys[i] = cy;
    if (!(Math.abs(cx) < 1e6 && Math.abs(cy) < 1e6)) return baseFan.fanOffsets(points, minDist);
    const k = keyOf(cx, cy);
    const b = buckets.get(k);
    if (b) b.push(i);
    else buckets.set(k, [i]);
  }
  for (let i = 0; i < n; i++) {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const b = buckets.get(keyOf(cxs[i] + dx, cys[i] + dy));
      if (!b) continue;
      for (let t = 0; t < b.length; t++) {
        const j = b[t];
        if (j > i && Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) < minDist) uf.union(i, j);
      }
    }
  }
  return build(points, minDist, uf.find);
}

const TAGS = {
  viewpoint: (name: string) => (name ? { tourism: "viewpoint", name } : { tourism: "viewpoint" }),
  peak: (name: string) => (name ? { natural: "peak", name } : { natural: "peak" }),
  attraction: (name: string) => (name ? { tourism: "attraction", name } : { tourism: "attraction" }),
} as const;
/** A: one loop, push, no flatMap/array-per-row. */
export function elemsA(rows: PlaceRow[]): unknown[] {
  const out: unknown[] = [];
  const KT: Record<string, Record<string, string>> = { viewpoint: { tourism: "viewpoint" }, peak: { natural: "peak" }, attraction: { tourism: "attraction" } };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const [type, id] = r.id.split("/");
    const tags = KT[r.kind];
    if (!tags || !type || !Number.isFinite(Number(id))) continue;
    out.push({ type, id: Number(id), lat: r.lat, lon: r.lng, tags: r.name ? { ...tags, name: r.name } : { ...tags } });
  }
  return out;
}
/** B: A + literal tag objects (no spread) for the 3 known kinds; others use the baseline per-row path. */
export function elemsB(rows: PlaceRow[]): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const k = r.kind;
    if (k !== "viewpoint" && k !== "peak" && k !== "attraction") {
      const one = baseToElements([r]);
      for (const e of one) out.push(e);
      continue;
    }
    const [type, id] = r.id.split("/");
    if (!type || !Number.isFinite(Number(id))) continue;
    out.push({ type, id: Number(id), lat: r.lat, lon: r.lng, tags: TAGS[k](r.name) });
  }
  return out;
}
/** C: B but indexOf instead of split (only when the id has a second '/'-free part). */
export function elemsC(rows: PlaceRow[]): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const k = r.kind;
    if (k !== "viewpoint" && k !== "peak" && k !== "attraction") {
      for (const e of baseToElements([r])) out.push(e);
      continue;
    }
    const s = r.id;
    const a = s.indexOf("/");
    let type: string, idStr: string | undefined;
    if (a < 0) { type = s; idStr = undefined; }
    else { type = s.slice(0, a); const b = s.indexOf("/", a + 1); idStr = b < 0 ? s.slice(a + 1) : s.slice(a + 1, b); }
    if (!type || !Number.isFinite(Number(idStr))) continue;
    out.push({ type, id: Number(idStr), lat: r.lat, lon: r.lng, tags: TAGS[k](r.name) });
  }
  return out;
}
