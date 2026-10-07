import { describe, expect, it } from "vitest";
import { optimizeOrder } from "./optimize-order";

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function randomSymmetric(n: number, seed: number): number[][] {
  const r = rng(seed);
  const pts = Array.from({ length: n }, () => [r() * 100, r() * 100]);
  return pts.map((a) => pts.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1])));
}

const cost = (d: number[][], order: number[]) =>
  order.slice(1).reduce((sum, v, i) => sum + d[order[i]][v], 0);

function bruteForce(d: number[][]): number {
  const n = d.length;
  let best = Infinity;
  const rest = Array.from({ length: n - 1 }, (_, i) => i + 1);
  const go = (path: number[], left: number[]) => {
    if (!left.length) return void (best = Math.min(best, cost(d, path)));
    left.forEach((v, i) => go([...path, v], left.filter((_, j) => j !== i)));
  };
  go([0], rest);
  return best;
}

function nearestNeighbour(d: number[][]): number[] {
  const order = [0];
  const left = new Set(d.map((_, i) => i).slice(1));
  while (left.size) {
    const last = order[order.length - 1];
    const next = [...left].reduce((a, b) => (d[last][b] < d[last][a] ? b : a));
    order.push(next);
    left.delete(next);
  }
  return order;
}

const line = (xs: number[]) => xs.map((a) => xs.map((b) => Math.abs(a - b)));

describe("optimizeOrder", () => {
  it("returns identity for tiny inputs", () => {
    expect(optimizeOrder([])).toEqual([]);
    expect(optimizeOrder([[0]])).toEqual([0]);
    expect(optimizeOrder(line([0, 5]))).toEqual([0, 1]);
  });

  it("sorts shuffled points on a line from the start", () => {
    const xs = [0, 50, 10, 40, 20, 30, 60, 5];
    const order = optimizeOrder(line(xs));
    expect(order.map((i) => xs[i])).toEqual([0, 5, 10, 20, 30, 40, 50, 60]);
  });

  it("sorts a large shuffled line (heuristic path)", () => {
    const r = rng(7);
    const xs = [0, ...Array.from({ length: 19 }, () => r() * 1000)];
    const order = optimizeOrder(line(xs));
    expect(order.map((i) => xs[i])).toEqual([...xs].sort((a, b) => a - b));
  });

  it("keeps the start fixed even when it is in the middle", () => {
    const xs = [30, 0, 60, 10, 50];
    const order = optimizeOrder(line(xs));
    expect(order[0]).toBe(0);
    expect(cost(line(xs), order)).toBe(bruteForce(line(xs)));
  });

  it("returns a valid permutation", () => {
    for (const n of [3, 5, 12, 25]) {
      const order = optimizeOrder(randomSymmetric(n, n));
      expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
      expect(order[0]).toBe(0);
    }
  });

  it("respects asymmetric durations", () => {
    // One-way-ish: going 0->2->1 is cheap, 0->1->2 is expensive.
    const d = [
      [0, 100, 1],
      [1, 0, 100],
      [100, 1, 0],
    ];
    expect(optimizeOrder(d)).toEqual([0, 2, 1]);
  });

  it("is exactly optimal vs brute force for n<=8", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const n = 4 + (seed % 5);
      const d = randomSymmetric(n, seed);
      expect(cost(d, optimizeOrder(d))).toBeCloseTo(bruteForce(d), 9);
    }
  });

  it("beats or equals nearest neighbour on larger instances", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const d = randomSymmetric(20, seed);
      expect(cost(d, optimizeOrder(d))).toBeLessThanOrEqual(cost(d, nearestNeighbour(d)) + 1e-9);
    }
  });

  it("treats non-finite durations as a large penalty", () => {
    const d = [
      [0, Infinity, 1],
      [1, 0, 1],
      [1, 1, 0],
    ] as number[][];
    expect(optimizeOrder(d)).toEqual([0, 2, 1]);
    const withNull = [
      [0, null, 1],
      [1, 0, 1],
      [1, 1, 0],
    ] as unknown as number[][];
    expect(optimizeOrder(withNull)).toEqual([0, 2, 1]);
  });
});
