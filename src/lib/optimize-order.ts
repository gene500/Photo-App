/** Largest instance solved exactly (Held-Karp is O(n² · 2ⁿ)); above this we use a heuristic. */
const EXACT_MAX = 9;
const PENALTY = 1e9; // stands in for unreachable / missing durations

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
  return n <= EXACT_MAX ? exact(d) : heuristic(d);
}

const pathCost = (d: number[][], order: number[]) => {
  let sum = 0;
  for (let i = 1; i < order.length; i++) sum += d[order[i - 1]][order[i]];
  return sum;
};

/** Held-Karp over the n-1 free stops. */
function exact(d: number[][]): number[] {
  const m = d.length - 1; // stop k (0-based) is index k+1
  const full = (1 << m) - 1;
  const best = Array.from({ length: full + 1 }, () => new Array<number>(m).fill(Infinity));
  const prev = Array.from({ length: full + 1 }, () => new Array<number>(m).fill(-1));
  for (let k = 0; k < m; k++) best[1 << k][k] = d[0][k + 1];
  for (let mask = 1; mask <= full; mask++) {
    for (let last = 0; last < m; last++) {
      const cur = best[mask][last];
      if (!(mask & (1 << last)) || cur === Infinity) continue;
      for (let next = 0; next < m; next++) {
        if (mask & (1 << next)) continue;
        const nm = mask | (1 << next);
        const c = cur + d[last + 1][next + 1];
        if (c < best[nm][next]) {
          best[nm][next] = c;
          prev[nm][next] = last;
        }
      }
    }
  }
  let last = 0;
  for (let k = 1; k < m; k++) if (best[full][k] < best[full][last]) last = k;
  const order: number[] = [];
  let mask = full;
  while (last !== -1) {
    order.push(last + 1);
    const p = prev[mask][last];
    mask &= ~(1 << last);
    last = p;
  }
  return [0, ...order.reverse()];
}

/** Nearest neighbour, then 2-opt and or-opt passes until nothing improves. */
function heuristic(d: number[][]): number[] {
  const n = d.length;
  const order = [0];
  const left = new Set(Array.from({ length: n - 1 }, (_, i) => i + 1));
  while (left.size) {
    const last = order[order.length - 1];
    let next = -1;
    for (const c of left) if (next === -1 || d[last][c] < d[last][next]) next = c;
    order.push(next);
    left.delete(next);
  }

  let cost = pathCost(d, order);
  let improved = true;
  while (improved) {
    improved = false;
    // 2-opt: reverse order[i..j]; j may be the last element (open end). Full recompute keeps asymmetry correct.
    for (let i = 1; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const cand = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
        const c = pathCost(d, cand);
        if (c < cost - 1e-9) {
          order.splice(0, n, ...cand);
          cost = c;
          improved = true;
        }
      }
    }
    // or-opt: move a segment of 1-3 stops elsewhere, in either direction.
    for (let len = 1; len <= 3; len++) {
      for (let i = 1; i + len <= n; i++) {
        const seg = order.slice(i, i + len);
        const rest = [...order.slice(0, i), ...order.slice(i + len)];
        for (let pos = 1; pos <= rest.length; pos++) {
          if (pos === i) continue;
          for (const s of [seg, [...seg].reverse()]) {
            const cand = [...rest.slice(0, pos), ...s, ...rest.slice(pos)];
            const c = pathCost(d, cand);
            if (c < cost - 1e-9) {
              order.splice(0, n, ...cand);
              cost = c;
              improved = true;
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
  return order;
}
