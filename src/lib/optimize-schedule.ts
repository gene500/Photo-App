import { getSunWindows } from "./best-time";
import { lightWindows } from "./light-windows";
import { optimizeOrder } from "./optimize-order";
import type { LightPref } from "./types";

export type ScheduleStop = { lat: number; lng: number; lightPref: LightPref; dwellMinutes: number };

export type ScheduleMiss = {
  /** Index in the submitted stop list. */
  stopIndex: number;
  minutes: number;
  pref: LightPref;
};

export type Schedule = { order: number[]; departAt: Date; misses: ScheduleMiss[] };

/** One minute of missed light costs as much as this many seconds of driving. */
const MISS_WEIGHT_SECONDS_PER_MIN = 3 * 60;
const EXACT_MAX_STOPS = 8;
const STEP_MS = 15 * 60_000;
const DAY_MS = 86_400_000;
const PENALTY = 1e9; // unreachable / missing durations, as in optimizeOrder
const EPS = 1e-9;

type Interval = [number, number];

/**
 * Pick the visiting order (stop 0 stays first) and the departure time that minimise
 * drive seconds + 3 x 60 x minutes of missed preferred light.
 * With no light preferences this is exactly the shortest-drive order at the default departure.
 */
export function optimizeSchedule(input: {
  durations: number[][];
  stops: ScheduleStop[];
  plannedDate: string;
  defaultDeparture: Date;
}): Schedule {
  const { durations, stops, defaultDeparture } = input;
  const n = stops.length;
  if (stops.every((s) => s.lightPref === "any") || n < 2) {
    return { order: optimizeOrder(durations), departAt: defaultDeparture, misses: [] };
  }

  const d = durations.map((row) => row.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : PENALTY)));
  const ctx = new Evaluator(d, stops, defaultDeparture.getTime());
  const { order, departMs } = n - 1 <= EXACT_MAX_STOPS ? exactSearch(ctx, n) : localSearch(ctx, n);
  return {
    order,
    departAt: departMs === defaultDeparture.getTime() ? defaultDeparture : new Date(departMs),
    misses: ctx.misses(order, departMs),
  };
}

class Evaluator {
  readonly candidates: number[];
  private readonly windowCache: Map<number, Interval[]>[];
  private readonly constrained: boolean[];
  private readonly arrivalOffsets: Float64Array;

  constructor(
    readonly d: number[][],
    readonly stops: ScheduleStop[],
    defaultMs: number,
  ) {
    this.candidates = [defaultMs];
    for (let t = defaultMs - 3_600_000; t <= defaultMs + 14 * 3_600_000; t += STEP_MS) {
      if (t !== defaultMs) this.candidates.push(t);
    }
    this.windowCache = stops.map(() => new Map());
    this.constrained = stops.map((s) => s.lightPref !== "any");
    this.arrivalOffsets = new Float64Array(stops.length);
  }

  drive(order: number[]): number {
    let sum = 0;
    for (let i = 1; i < order.length; i++) sum += this.d[order[i - 1]!]![order[i]!]!;
    return sum;
  }

  /** Fill arrivalOffsets[k] = ms after departure that the k-th stop of `order` is reached. */
  private offsets(order: number[]): Float64Array {
    const off = this.arrivalOffsets;
    let t = 0;
    off[0] = 0;
    for (let k = 1; k < order.length; k++) {
      t += this.d[order[k - 1]!]![order[k]!]! * 1000 + this.stops[order[k - 1]!]!.dwellMinutes * 60_000;
      off[k] = t;
    }
    return off;
  }

  /** Light windows (epoch ms) of stop `i` on the solar day containing `arrivalMs`; cached per day. */
  private windows(i: number, arrivalMs: number): Interval[] {
    const s = this.stops[i]!;
    const day = Math.floor((arrivalMs + s.lng * 240_000) / DAY_MS);
    const cache = this.windowCache[i]!;
    let w = cache.get(day);
    if (!w) {
      const date = new Date(day * DAY_MS).toISOString().slice(0, 10);
      w = lightWindows(s.lightPref, getSunWindows(s.lat, s.lng, date)).map(([a, b]) => [a.getTime(), b.getTime()] as Interval);
      cache.set(day, w);
    }
    return w;
  }

  private missAt(i: number, arrivalMs: number): number {
    const w = this.windows(i, arrivalMs);
    if (w.length === 0) return 0;
    const end = arrivalMs + this.stops[i]!.dwellMinutes * 60_000;
    let best = Infinity;
    for (const [ws, we] of w) {
      if (end >= ws && arrivalMs <= we) return 0;
      best = Math.min(best, end < ws ? ws - end : arrivalMs - we);
    }
    return best / 60_000;
  }

  /** Total missed minutes for `order` when leaving at `departMs`. */
  missTotal(order: number[], departMs: number, off = this.offsets(order)): number {
    let total = 0;
    for (let k = 0; k < order.length; k++) {
      const i = order[k]!;
      if (this.constrained[i]) total += this.missAt(i, departMs + off[k]!);
    }
    return total;
  }

  cost(order: number[], departMs: number): number {
    return this.drive(order) + MISS_WEIGHT_SECONDS_PER_MIN * this.missTotal(order, departMs);
  }

  /** Best candidate departure for a fixed order (the default wins ties, then the earliest). */
  bestDeparture(order: number[]): { departMs: number; cost: number } {
    const off = this.offsets(order);
    const drive = this.drive(order);
    let departMs = this.candidates[0]!;
    let best = Infinity;
    for (const t of this.candidates) {
      const c = drive + MISS_WEIGHT_SECONDS_PER_MIN * this.missTotal(order, t, off);
      if (c < best - EPS) {
        best = c;
        departMs = t;
      }
    }
    return { departMs, cost: best };
  }

  misses(order: number[], departMs: number): ScheduleMiss[] {
    const off = this.offsets(order);
    const out: ScheduleMiss[] = [];
    order.forEach((i, k) => {
      if (!this.constrained[i]) return;
      const minutes = this.missAt(i, departMs + off[k]!);
      if (minutes > 0) out.push({ stopIndex: i, minutes, pref: this.stops[i]!.lightPref });
    });
    return out;
  }
}

type Solution = { order: number[]; departMs: number; cost: number };

/** Every order of stops 1..n-1 against every candidate departure. */
function exactSearch(ctx: Evaluator, n: number): Solution {
  let best: Solution = { order: [], departMs: ctx.candidates[0]!, cost: Infinity };
  const order = [0];
  const used = new Array<boolean>(n).fill(false);
  used[0] = true;
  const visit = () => {
    if (order.length === n) {
      const { departMs, cost } = ctx.bestDeparture(order);
      if (cost < best.cost - EPS) best = { order: [...order], departMs, cost };
      return;
    }
    for (let i = 1; i < n; i++) {
      if (used[i]) continue;
      used[i] = true;
      order.push(i);
      visit();
      order.pop();
      used[i] = false;
    }
  };
  visit();
  return best;
}

const MAX_ROUNDS = 25;

/** Local search seeded from nearest-neighbour and window-sorted orders. */
function localSearch(ctx: Evaluator, n: number): Solution {
  const seeds = [nearestNeighbour(ctx.d, n), windowSorted(ctx.stops, n), optimizeOrder(ctx.d)];
  let best: Solution | null = null;
  for (const seed of seeds) {
    const sol = improve(ctx, seed);
    if (!best || sol.cost < best.cost - EPS) best = sol;
  }
  return best!;
}

/**
 * Alternate: move stops around at the current departure (swap / 2-opt / or-opt, first
 * improvement), then re-pick the best departure for the new order, until nothing improves.
 */
function improve(ctx: Evaluator, start: number[]): Solution {
  let order = start;
  let { departMs, cost } = ctx.bestDeparture(order);
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let moved = false;
    let again = true;
    while (again) {
      again = false;
      for (const cand of neighbours(order)) {
        const c = ctx.cost(cand, departMs);
        if (c < cost - EPS) {
          order = cand;
          cost = c;
          moved = again = true;
          break;
        }
      }
    }
    const re = ctx.bestDeparture(order);
    const shifted = re.departMs !== departMs && re.cost < cost - EPS;
    if (shifted) {
      departMs = re.departMs;
      cost = re.cost;
    }
    if (!moved && !shifted) break;
  }
  return { order, departMs, cost };
}

/** Swaps, 2-opt reversals and or-opt moves (segments of 1-3, either direction), lazily. */
function* neighbours(order: number[]): Generator<number[]> {
  const n = order.length;
  for (let i = 1; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const swap = order.slice();
      swap[i] = order[j]!;
      swap[j] = order[i]!;
      yield swap;
      yield [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
    }
  }
  for (let len = 1; len <= 3; len++) {
    for (let i = 1; i + len <= n; i++) {
      const seg = order.slice(i, i + len);
      const rest = [...order.slice(0, i), ...order.slice(i + len)];
      for (let pos = 1; pos <= rest.length; pos++) {
        if (pos === i) continue;
        yield [...rest.slice(0, pos), ...seg, ...rest.slice(pos)];
        if (len > 1) yield [...rest.slice(0, pos), ...[...seg].reverse(), ...rest.slice(pos)];
      }
    }
  }
}

function nearestNeighbour(d: number[][], n: number): number[] {
  const order = [0];
  const left = new Set(Array.from({ length: n - 1 }, (_, i) => i + 1));
  while (left.size) {
    const last = order[order.length - 1]!;
    let next = -1;
    for (const c of left) if (next === -1 || d[last]![c]! < d[last]![next]!) next = c;
    order.push(next);
    left.delete(next);
  }
  return order;
}

/** Sunrise stops first, sunset stops last, everything else between (stable). */
function windowSorted(stops: ScheduleStop[], n: number): number[] {
  const rank = (p: LightPref) => (p === "sunrise" ? 0 : p === "sunset" ? 2 : 1);
  const rest = Array.from({ length: n - 1 }, (_, i) => i + 1);
  rest.sort((a, b) => rank(stops[a]!.lightPref) - rank(stops[b]!.lightPref) || a - b);
  return [0, ...rest];
}
