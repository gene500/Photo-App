/** Largest instance solved exactly (Held-Karp is O(n² · 2ⁿ), about 0.3M steps at 12); above this we use a heuristic. */
export const EXACT_MAX = 12;
export const PENALTY = 1e9; // stands in for unreachable / missing durations

/**
 * Cheapest visiting order for an open path that starts at index 0 and ends anywhere.
 * `durations[i][j]` is drive seconds from i to j (may be asymmetric; non-finite = unreachable).
 * Returns a permutation of 0..n-1 with 0 first.
 */
export function optimizeOrder(durations: number[][]): number[] {
  const n = durations.length;
  const identity = Array.from({ length: n }, (_, i) => i);
  if (n <= 2) return identity;
  const d = durations.map((row) => row.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : PENALTY)));
  const best = n <= EXACT_MAX ? exact(d) : heuristic(d);
  // A different order that gains nothing (e.g. stops at the same spot) is only churn: keep the order the owner has.
  return pathCost(d, identity) <= pathCost(d, best) + 1e-9 ? identity : best;
}

const pathCost = (d: number[][], order: number[]) => {
  let sum = 0;
  for (let i = 1; i < order.length; i++) sum += d[order[i - 1]][order[i]];
  return sum;
};

/**
 * Held-Karp over the n-1 free stops, in flat typed tables. Each (visited set, last stop) state takes the cheapest of its predecessors,
 * scanned in ascending order with a strict `<`, so ties resolve to the lowest predecessor exactly as a forward sweep would.
 */
function exact(d: number[][]): number[] {
  const m = d.length - 1; // stop k (0-based) is index k+1
  const full = (1 << m) - 1;
  const best = new Float64Array((full + 1) * m).fill(Infinity);
  const prev = new Int8Array((full + 1) * m).fill(-1);
  const w = new Float64Array(m * m);
  for (let a = 0; a < m; a++) for (let b = 0; b < m; b++) w[a * m + b] = d[a + 1]![b + 1]!;
  for (let k = 0; k < m; k++) best[(1 << k) * m + k] = d[0]![k + 1]!;
  for (let set = 1; set <= full; set++) {
    for (let bits = set; bits; bits &= bits - 1) {
      const next = 31 - Math.clz32(bits & -bits);
      const mask = set & ~(1 << next);
      if (!mask) continue;
      let bestCost = Infinity;
      let bestLast = -1;
      for (let lastBits = mask; lastBits; lastBits &= lastBits - 1) {
        const last = 31 - Math.clz32(lastBits & -lastBits);
        const cur = best[mask * m + last]!;
        if (cur === Infinity) continue;
        const c = cur + w[last * m + next]!;
        if (c < bestCost) {
          bestCost = c;
          bestLast = last;
        }
      }
      best[set * m + next] = bestCost;
      prev[set * m + next] = bestLast;
    }
  }
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

/** Perturbed restarts after the first descent: a fixed count, so the answer is the same on every machine. */
const restartsFor = (n: number) => Math.max(8, Math.round(160 / n));

/** Nearest neighbour and a local search, then perturbed restarts of the best order (seeded, so deterministic). */
function heuristic(d: number[][]): number[] {
  const n = d.length;
  const order = [0];
  const left = Array.from({ length: n - 1 }, (_, i) => i + 1); // ascending, like the Set it replaces
  while (left.length) {
    const last = order[order.length - 1];
    let at = 0;
    for (let q = 1; q < left.length; q++) if (d[last][left[q]] < d[last][left[at]]) at = q;
    order.push(left[at]);
    left.splice(at, 1);
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
    // A few random swaps, or a reversed random segment; stop 0 never moves.
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
}

/**
 * 2-opt and or-opt passes on a copy of `start` until nothing improves. Every candidate is scored by the same left-to-right sum a full
 * recompute makes, but the unchanged leading legs come from `pre` (their partial sums are bit-identical) and nothing is allocated.
 */
function descend(d: number[][], start: number[]): number[] {
  const n = d.length;
  let w = flatCache.get(d);
  if (!w) {
    w = new Float64Array(n * n);
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) w[a * n + b] = d[a][b];
    flatCache.set(d, w);
  }
  const order = Int32Array.from(start);
  const cand = new Int32Array(n);
  const pre = new Float64Array(n); // pre[k] = cost of the first k legs of `order`
  const rebuild = () => {
    for (let k = 1; k < n; k++) pre[k] = pre[k - 1] + w![order[k - 1] * n + order[k]];
  };
  const sumFrom = (from: number) => {
    let s = pre[from - 1];
    for (let k = from; k < n; k++) s += w![cand[k - 1] * n + cand[k]];
    return s;
  };
  rebuild();
  let cost = pre[n - 1];
  let improved = true;
  while (improved) {
    improved = false;
    // 2-opt: reverse order[i..j]; j may be the last element (open end). Full recompute keeps asymmetry correct.
    for (let i = 1; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        for (let k = 0; k < i; k++) cand[k] = order[k];
        for (let k = i; k <= j; k++) cand[k] = order[i + j - k];
        for (let k = j + 1; k < n; k++) cand[k] = order[k];
        const c = sumFrom(i);
        if (c < cost - 1e-9) {
          order.set(cand);
          cost = c;
          improved = true;
          rebuild();
        }
      }
    }
    // or-opt: move a segment of 1-3 stops elsewhere, in either direction.
    for (let len = 1; len <= 3; len++) {
      for (let i = 1; i + len <= n; i++) {
        for (let pos = 1; pos <= n - len; pos++) {
          if (pos === i) continue;
          // A single stop reversed is the same order, so it cannot score differently from the forward try.
          for (let reversed = 0; reversed < (len > 1 ? 2 : 1); reversed++) {
            for (let k = 0; k < n; k++) {
              if (k < pos) cand[k] = k < i ? order[k] : order[k + len];
              else if (k < pos + len) cand[k] = order[reversed ? i + len - 1 - (k - pos) : i + (k - pos)];
              else cand[k] = k - len < i ? order[k - len] : order[k];
            }
            const c = sumFrom(Math.min(i, pos));
            if (c < cost - 1e-9) {
              order.set(cand);
              cost = c;
              improved = true;
              rebuild();
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
}

const flatCache = new WeakMap<number[][], Float64Array>();
