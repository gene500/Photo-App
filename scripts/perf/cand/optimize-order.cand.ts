/* Candidate strategies for src/lib/optimize-order.ts. Every candidate must return exactly what the baseline returns. */
import { EXACT_MAX, PENALTY } from "../baseline/optimize-order.baseline";

type Exact = (d: number[][]) => number[];
type Heur = (d: number[][]) => number[];

const sanitise = (durations: number[][]) => durations.map((row) => row.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : PENALTY)));
const pathCost = (d: number[][], order: number[]) => {
  let sum = 0;
  for (let i = 1; i < order.length; i++) sum += d[order[i - 1]!]![order[i]!]!;
  return sum;
};

export function build(exact: Exact, heuristic: Heur) {
  return (durations: number[][]): number[] => {
    const n = durations.length;
    const identity = Array.from({ length: n }, (_, i) => i);
    if (n <= 2) return identity;
    const d = sanitise(durations);
    const best = n <= EXACT_MAX ? exact(d) : heuristic(d);
    return pathCost(d, identity) <= pathCost(d, best) + 1e-9 ? identity : best;
  };
}

/* ---------- Held-Karp candidates ---------- */

/** E1: flat Float64Array / Int8Array tables, same push loops and order as the baseline. */
export function exactFlat(d: number[][]): number[] {
  const m = d.length - 1;
  const full = (1 << m) - 1;
  const best = new Float64Array((full + 1) * m).fill(Infinity);
  const prev = new Int8Array((full + 1) * m).fill(-1);
  const w = new Float64Array(m * m);
  for (let a = 0; a < m; a++) for (let b = 0; b < m; b++) w[a * m + b] = d[a + 1]![b + 1]!;
  for (let k = 0; k < m; k++) best[(1 << k) * m + k] = d[0]![k + 1]!;
  for (let mask = 1; mask <= full; mask++) {
    for (let last = 0; last < m; last++) {
      const cur = best[mask * m + last]!;
      if (!(mask & (1 << last)) || cur === Infinity) continue;
      for (let next = 0; next < m; next++) {
        if (mask & (1 << next)) continue;
        const idx = (mask | (1 << next)) * m + next;
        const c = cur + w[last * m + next]!;
        if (c < best[idx]!) {
          best[idx] = c;
          prev[idx] = last;
        }
      }
    }
  }
  return trace(best, prev, m, full);
}

/** E2: flat tables, and only the set bits of the mask / unset bits are visited (ascending, so ties resolve alike). */
export function exactBits(d: number[][]): number[] {
  const m = d.length - 1;
  const full = (1 << m) - 1;
  const best = new Float64Array((full + 1) * m).fill(Infinity);
  const prev = new Int8Array((full + 1) * m).fill(-1);
  const w = new Float64Array(m * m);
  for (let a = 0; a < m; a++) for (let b = 0; b < m; b++) w[a * m + b] = d[a + 1]![b + 1]!;
  for (let k = 0; k < m; k++) best[(1 << k) * m + k] = d[0]![k + 1]!;
  for (let mask = 1; mask <= full; mask++) {
    const free = full & ~mask;
    for (let lm = mask; lm; lm &= lm - 1) {
      const last = 31 - Math.clz32(lm & -lm);
      const cur = best[mask * m + last]!;
      if (cur === Infinity) continue;
      for (let fm = free; fm; fm &= fm - 1) {
        const next = 31 - Math.clz32(fm & -fm);
        const idx = (mask | (1 << next)) * m + next;
        const c = cur + w[last * m + next]!;
        if (c < best[idx]!) {
          best[idx] = c;
          prev[idx] = last;
        }
      }
    }
  }
  return trace(best, prev, m, full);
}

/** E3: pull form. For each (mask, next) scan the predecessors in ascending order with a strict <, the same winner as the push form. */
export function exactPull(d: number[][]): number[] {
  const m = d.length - 1;
  const full = (1 << m) - 1;
  const best = new Float64Array((full + 1) * m).fill(Infinity);
  const prev = new Int8Array((full + 1) * m).fill(-1);
  const w = new Float64Array(m * m);
  for (let a = 0; a < m; a++) for (let b = 0; b < m; b++) w[a * m + b] = d[a + 1]![b + 1]!;
  for (let k = 0; k < m; k++) best[(1 << k) * m + k] = d[0]![k + 1]!;
  for (let nm = 1; nm <= full; nm++) {
    for (let nb = nm; nb; nb &= nb - 1) {
      const next = 31 - Math.clz32(nb & -nb);
      const mask = nm & ~(1 << next);
      if (!mask) continue;
      let bv = Infinity;
      let bp = -1;
      for (let lm = mask; lm; lm &= lm - 1) {
        const last = 31 - Math.clz32(lm & -lm);
        const cur = best[mask * m + last]!;
        if (cur === Infinity) continue;
        const c = cur + w[last * m + next]!;
        if (c < bv) {
          bv = c;
          bp = last;
        }
      }
      best[nm * m + next] = bv;
      prev[nm * m + next] = bp;
    }
  }
  return trace(best, prev, m, full);
}

function trace(best: Float64Array, prev: Int8Array, m: number, full: number): number[] {
  let last = 0;
  for (let k = 1; k < m; k++) if (best[full * m + k]! < best[full * m + last]!) last = k;
  const order: number[] = [];
  let mask = full;
  while (last !== -1) {
    order.push(last + 1);
    const p = prev[mask * m + last]!;
    mask &= ~(1 << last);
    last = p;
  }
  return [0, ...order.reverse()];
}

/* ---------- heuristic candidates ---------- */

const restartsFor = (n: number) => Math.max(8, Math.round(160 / n));

/** The seeded perturbation loop and nearest neighbour, shared; only `descend` differs between candidates. */
function heuristicWith(descend: (d: number[][], start: number[]) => number[]): Heur {
  return (d) => {
    const n = d.length;
    const order = [0];
    const left: number[] = [];
    for (let i = 1; i < n; i++) left.push(i);
    while (left.length) {
      const last = order[order.length - 1]!;
      let nextIdx = 0;
      for (let q = 1; q < left.length; q++) if (d[last]![left[q]!]! < d[last]![left[nextIdx]!]!) nextIdx = q;
      order.push(left[nextIdx]!);
      left.splice(nextIdx, 1);
    }
    let best = descend(d, order);
    let bestCost = pathCost(d, best);
    let state = 0x2545f491;
    const rand = (max: number) => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return Math.floor((state / 4294967296) * max);
    };
    for (let r = 0; r < restartsFor(n); r++) {
      const start = best.slice();
      for (let k = 0; k < 2 + (r % 3); k++) {
        const i = 1 + rand(n - 1);
        const j = 1 + rand(n - 1);
        if (r % 2 === 0) [start[i], start[j]] = [start[j]!, start[i]!];
        else start.splice(Math.min(i, j), Math.abs(i - j) + 1, ...start.slice(Math.min(i, j), Math.max(i, j) + 1).reverse());
      }
      const cand = descend(d, start);
      const c = pathCost(d, cand);
      if (c < bestCost - 1e-9) {
        best = cand;
        bestCost = c;
      }
    }
    return best;
  };
}

/**
 * Allocation-free descent. `prefix` reuses the partial sum of the unchanged leading legs (bit-identical: same left-to-right additions),
 * `abort` stops summing once the partial already reaches the acceptance threshold (valid because every duration is >= 0).
 */
const flatCache = new WeakMap<number[][], { w: Float64Array; nonNeg: boolean }>();
function makeDescend(opts: { prefix: boolean; abort: boolean }) {
  return (d: number[][], start: number[]): number[] => {
    const n = d.length;
    let flat = flatCache.get(d);
    if (!flat) {
      const w0 = new Float64Array(n * n);
      let nn = true;
      for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) { const v = d[a]![b]!; w0[a * n + b] = v; if (v < 0) nn = false; }
      flat = { w: w0, nonNeg: nn };
      flatCache.set(d, flat);
    }
    const { w, nonNeg } = flat;
    const abort = opts.abort && nonNeg;
    const order = Int32Array.from(start);
    const cand = new Int32Array(n);
    const pre = new Float64Array(n);
    const rebuildPre = () => {
      pre[0] = 0;
      for (let k = 1; k < n; k++) pre[k] = pre[k - 1]! + w[order[k - 1]! * n + order[k]!]!;
    };
    rebuildPre();
    let cost = pre[n - 1]!;
    // Sum legs of `cand` from index `from` (cand[from-1] must be valid), starting from `s`.
    const sumFrom = (from: number, s: number, thr: number) => {
      for (let k = from; k < n; k++) {
        s += w[cand[k - 1]! * n + cand[k]!]!;
        if (abort && s >= thr) return s;
      }
      return s;
    };
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 1; i < n - 1; i++) {
        for (let j = i + 1; j < n; j++) {
          for (let k = 0; k < i; k++) cand[k] = order[k]!;
          for (let k = i; k <= j; k++) cand[k] = order[i + j - k]!;
          for (let k = j + 1; k < n; k++) cand[k] = order[k]!;
          const thr = cost - 1e-9;
          const c = opts.prefix ? sumFrom(i, pre[i - 1]!, thr) : sumFrom(1, 0, thr);
          if (c < thr) {
            order.set(cand);
            cost = c;
            improved = true;
            rebuildPre();
          }
        }
      }
      for (let len = 1; len <= 3; len++) {
        for (let i = 1; i + len <= n; i++) {
          const rl = n - len;
          for (let pos = 1; pos <= rl; pos++) {
            if (pos === i) continue;
            for (let variant = 0; variant < 2; variant++) {
              if (variant === 1 && len === 1) break; // reversed single stop is the same order: same cost, already rejected
              for (let k = 0; k < n; k++) {
                let v: number;
                if (k < pos) v = k < i ? order[k]! : order[k + len]!;
                else if (k < pos + len) v = variant === 0 ? order[i + (k - pos)]! : order[i + len - 1 - (k - pos)]!;
                else { const r = k - len; v = r < i ? order[r]! : order[r + len]!; }
                cand[k] = v;
              }
              const thr = cost - 1e-9;
              const c = opts.prefix ? sumFrom(Math.min(i, pos), pre[Math.min(i, pos) - 1]!, thr) : sumFrom(1, 0, thr);
              if (c < thr) {
                order.set(cand);
                cost = c;
                improved = true;
                rebuildPre();
                break;
              }
            }
            if (improved) break;
          }
          if (improved) break;
        }
        if (improved) break;
      }
    }
    return Array.from(order);
  };
}

export const heuristicH1 = heuristicWith(makeDescend({ prefix: false, abort: false }));
export const heuristicH2 = heuristicWith(makeDescend({ prefix: true, abort: true }));
export const heuristicH3 = heuristicWith(makeDescend({ prefix: true, abort: false }));
export { exactFlat as E1, exactBits as E2, exactPull as E3 };
