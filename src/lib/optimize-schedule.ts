import { getSunWindows } from "./best-time";
import { lightWindows } from "./light-windows";
import { EXACT_MAX, optimizeOrder } from "./optimize-order";
import type { LightPref, StopPriority } from "./types";

export type ScheduleStop = { lat: number; lng: number; lightPref: LightPref; dwellMinutes: number; priority?: StopPriority };

export type ScheduleMiss = {
  /** Index in the submitted stop list. */
  stopIndex: number;
  minutes: number;
  pref: LightPref;
  priority: StopPriority;
};

/** `complete` is false when the time budget ended the search early, so the order is good but not necessarily the best the search could find. */
export type Schedule = { order: number[]; departAt: Date; misses: ScheduleMiss[]; complete?: boolean };

/** One minute of missed light costs as much as this many seconds of driving. */
const MISS_WEIGHT_SECONDS_PER_MIN = 3 * 60;
/** Multiplier on a stop's missed minutes. "must" is large enough that no amount of driving outweighs missing it. */
const PRIORITY_WEIGHT: Record<StopPriority, number> = { normal: 1, high: 8, must: 1000 };
/** Time priority: every stop counts the same, so only drive time and missed light decide the route. */
const FLAT_WEIGHT: Record<StopPriority, number> = { normal: 1, high: 1, must: 1 };
const EXACT_MAX_STOPS = 7; // 8 stops (7! orders x ~65 departures) held the event loop for ~0.9 s per request
const STEP_MS = 15 * 60_000;
const DAY_MS = 86_400_000;
const PENALTY = 1e9; // unreachable / missing durations, as in optimizeOrder
const EPS = 1e-9;

/** Whether the order for `stopCount` stops is provably the best one (exact search), rather than the best a heuristic found. */
export function isExactOptimization(stopCount: number, usesLight: boolean): boolean {
  return usesLight ? stopCount - 1 <= EXACT_MAX_STOPS : stopCount <= EXACT_MAX;
}

type Interval = [number, number];

/**
 * Pick the visiting order (stop 0 stays first) and the departure time that minimise
 * drive seconds + 3 x 60 x minutes of missed preferred light.
 * With no light preferences this is exactly the shortest-drive order at the default departure.
 */
export function optimizeSchedule(input: ScheduleInput): Schedule {
  const plan = plannedSearch(input);
  if ("done" in plan) return plan.done;
  return plan.finish(drain(plan.steps(() => false)));
}

/**
 * Same answer as `optimizeSchedule`, but for a shared server: it hands the event loop back between steps (so other requests
 * are served while it works) and stops improving once `budgetMs` of wall-clock time has passed, returning the best found so far.
 * Without a time cutoff the result is identical to the synchronous one.
 */
export async function optimizeScheduleAsync(input: ScheduleInput, opts: { budgetMs?: number } = {}): Promise<Schedule> {
  const plan = plannedSearch(input);
  if ("done" in plan) {
    await yieldToEventLoop();
    return plan.done;
  }
  const deadline = opts.budgetMs === undefined ? Infinity : Date.now() + opts.budgetMs;
  let cut = false;
  const steps = plan.steps(() => (cut ||= Date.now() > deadline));
  for (;;) {
    const r = steps.next();
    if (r.done) return { ...plan.finish(r.value), complete: !cut };
    await yieldToEventLoop();
  }
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

type ScheduleInput = {
  durations: number[][];
  stops: ScheduleStop[];
  plannedDate: string;
  defaultDeparture: Date;
  /** A departure to keep when it is as good as any other (e.g. the trip's saved start); the search window still follows `defaultDeparture`. */
  preferredDeparture?: Date;
  /** "priority" (default) weighs High and Must stops heavily; "time" weighs every stop alike. */
  focus?: "priority" | "time";
};

function plannedSearch(input: ScheduleInput):
  | { done: Schedule }
  | { steps: (over: () => boolean) => Generator<void, Solution>; finish: (sol: Solution) => Schedule } {
  const { durations, stops, defaultDeparture, preferredDeparture } = input;
  const n = stops.length;
  if (stops.every((s) => s.lightPref === "any") || n < 2) {
    return { done: { order: optimizeOrder(durations), departAt: defaultDeparture, misses: [] } };
  }
  const d = sanitised(durations);
  const ctx = new Evaluator(d, stops, defaultDeparture.getTime(), preferredDeparture?.getTime(), input.focus);
  return {
    steps: (over) => (n - 1 <= EXACT_MAX_STOPS ? exactSteps(ctx, n, over) : localSteps(ctx, n, over)),
    finish: ({ order, departMs }) => ({
      order,
      departAt:
        departMs === preferredDeparture?.getTime() ? preferredDeparture : departMs === defaultDeparture.getTime() ? defaultDeparture : new Date(departMs),
      misses: ctx.misses(order, departMs),
    }),
  };
}

const sanitised = (durations: number[][]) => durations.map((row) => row.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : PENALTY)));

/** The objective optimizeSchedule minimises, for a given order and departure (for comparing searches). */
export function scheduleCost(input: ScheduleInput, order: number[], departAt: Date): number {
  const ctx = new Evaluator(sanitised(input.durations), input.stops, input.defaultDeparture.getTime(), input.preferredDeparture?.getTime(), input.focus);
  return ctx.cost(order, departAt.getTime());
}

/** Reference search over every order: slow beyond 8 stops (n! x departures), meant for checking the heuristic in tests. */
export function optimizeScheduleExact(input: ScheduleInput): Schedule {
  const ctx = new Evaluator(sanitised(input.durations), input.stops, input.defaultDeparture.getTime(), input.preferredDeparture?.getTime(), input.focus);
  const { order, departMs } = exactSearch(ctx, input.stops.length);
  return { order, departAt: new Date(departMs), misses: ctx.misses(order, departMs) };
}

class Evaluator {
  readonly candidates: number[];
  private readonly windowCache: Map<number, Interval[]>[];
  private readonly constrained: boolean[];
  private readonly weight: number[];
  private readonly arrivalOffsets: Float64Array;

  constructor(
    readonly d: number[][],
    readonly stops: ScheduleStop[],
    defaultMs: number,
    preferredMs?: number,
    focus: "priority" | "time" = "priority",
  ) {
    // First wins ties: the preferred departure, then the default, then the grid around the default.
    this.candidates = preferredMs !== undefined && preferredMs !== defaultMs ? [preferredMs, defaultMs] : [defaultMs];
    for (let t = defaultMs - 3_600_000; t <= defaultMs + 14 * 3_600_000; t += STEP_MS) {
      if (t !== defaultMs && t !== preferredMs) this.candidates.push(t);
    }
    this.windowCache = stops.map(() => new Map());
    this.constrained = stops.map((s) => s.lightPref !== "any");
    const weights = focus === "time" ? FLAT_WEIGHT : PRIORITY_WEIGHT;
    this.weight = stops.map((s) => weights[s.priority ?? "normal"]);
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

  /** Total missed minutes for `order` when leaving at `departMs`, each stop counted by its priority weight. */
  missTotal(order: number[], departMs: number, off = this.offsets(order)): number {
    let total = 0;
    for (let k = 0; k < order.length; k++) {
      const i = order[k]!;
      if (this.constrained[i]) total += this.weight[i]! * this.missAt(i, departMs + off[k]!);
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
      if (minutes > 0) out.push({ stopIndex: i, minutes, pref: this.stops[i]!.lightPref, priority: this.stops[i]!.priority ?? "normal" });
    });
    return out;
  }
}

type Solution = { order: number[]; departMs: number; cost: number };

/** Every order of stops 1..n-1 against every candidate departure. Yields after each choice of the second stop. */
function* exactSteps(ctx: Evaluator, n: number, over: () => boolean): Generator<void, Solution> {
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
  // The first level is unrolled so the generator can pause between its branches.
  for (let first = 1; first < n; first++) {
    used[first] = true;
    order.push(first);
    visit();
    order.pop();
    used[first] = false;
    if (first < n - 1) {
      yield;
      if (over()) break;
    }
  }
  return best;
}

function exactSearch(ctx: Evaluator, n: number): Solution {
  return drain(exactSteps(ctx, n, () => false));
}

/** Runs a stepwise search to the end without ever pausing. */
function drain<T>(g: Generator<void, T>): T {
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}

const MAX_ROUNDS = 25;

/**
 * Extra perturbed restarts after the seeded descents. A fixed count per size so the answer is the same on every machine
 * (the server may additionally stop early on a time budget, see `optimizeScheduleAsync`); each restart costs more as stops
 * are added, so large trips get fewer. Kept modest: this runs on the request thread of a shared server.
 */
const restartsFor = (n: number) => (n <= 12 ? 100 : Math.max(4, Math.floor(150 / n)));

/**
 * Local search: descents from several seeds (nearest-neighbour, window-sorted, must-stops-first, shortest drive), then
 * iterated local search that perturbs the best order with a fixed-seed generator, so the same input gives the same answer.
 */
function* localSteps(ctx: Evaluator, n: number, over: () => boolean): Generator<void, Solution> {
  const seeds = [nearestNeighbour(ctx.d, n), windowSorted(ctx.stops, n), mustFirst(ctx.stops, n), optimizeOrder(ctx.d)];
  let best: Solution | null = null;
  for (const seed of seeds) {
    const sol = improve(ctx, seed);
    if (!best || sol.cost < best.cost - EPS) best = sol;
    yield;
  }
  let state = 0x9e3779b9;
  const rand = (max: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor((state / 4294967296) * max);
  };
  for (let r = 0, restarts = restartsFor(n); r < restarts && !over(); r++) {
    const order = best!.order.slice();
    // Alternate a few random swaps with a reversed random segment; stop 0 never moves.
    for (let k = 0; k < 2 + (r % 3); k++) {
      const i = 1 + rand(n - 1);
      const j = 1 + rand(n - 1);
      if (r % 2 === 0) [order[i], order[j]] = [order[j]!, order[i]!];
      else order.splice(Math.min(i, j), Math.abs(i - j) + 1, ...order.slice(Math.min(i, j), Math.max(i, j) + 1).reverse());
    }
    // Every other restart also jumps to another departure: the best order depends on it and the landscape is rugged.
    const sol = improve(ctx, order, r % 4 < 2 ? undefined : ctx.candidates[rand(ctx.candidates.length)]);
    if (sol.cost < best!.cost - EPS) best = sol;
    yield;
  }
  return best!;
}

/**
 * Alternate: move stops around at the current departure (swap / 2-opt / or-opt, first
 * improvement), then re-pick the best departure for the new order, until nothing improves.
 */
function improve(ctx: Evaluator, start: number[], from?: number): Solution {
  let order = start;
  let { departMs, cost } = from === undefined ? ctx.bestDeparture(order) : { departMs: from, cost: ctx.cost(start, from) };
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

/** Must stops first, then high, then the rest, each group sunrise to sunset. */
function mustFirst(stops: ScheduleStop[], n: number): number[] {
  const rank = (p: LightPref) => (p === "sunrise" ? 0 : p === "sunset" ? 2 : 1);
  const weight = (s: ScheduleStop) => ({ must: 0, high: 1, normal: 2 })[s.priority ?? "normal"];
  const rest = Array.from({ length: n - 1 }, (_, i) => i + 1);
  rest.sort((a, b) => weight(stops[a]!) - weight(stops[b]!) || rank(stops[a]!.lightPref) - rank(stops[b]!.lightPref) || a - b);
  return [0, ...rest];
}
