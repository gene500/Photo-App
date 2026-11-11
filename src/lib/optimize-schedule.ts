import { daylightInterval, getSunWindows } from "./best-time";
import { lightWindows } from "./light-windows";
import { EXACT_MAX, optimizeOrder, PENALTY } from "./optimize-order";
import type { LightPref, StopPriority } from "./types";

export type ScheduleStop = { lat: number; lng: number; lightPref: LightPref; dwellMinutes: number; priority?: StopPriority };

type ScheduleMiss = {
  /** Index in the submitted stop list. */
  stopIndex: number;
  minutes: number;
  pref: LightPref;
  priority: StopPriority;
};

/** A stop whose whole visit falls outside daylight (and outside its own preferred light); `minutes` is the gap to the nearest daylight. */
type ScheduleDark = { stopIndex: number; minutes: number; priority: StopPriority };

/**
 * `dark` lists the visits that miss daylight; `timed` is true when the departure was searched (so `departAt` is a
 * real answer), false when the shortest order at the default start was kept as it was.
 * `complete` is false when the time budget ended the search early, so the order is good but not necessarily the best the search could find. */
export type Schedule = { order: number[]; departAt: Date; misses: ScheduleMiss[]; dark: ScheduleDark[]; timed: boolean; complete?: boolean };

/**
 * The numbers the cost function is built from. `OptimizeTuning` can override any of them per call (the benchmark in
 * scripts/bench-optimize.ts compares settings this way); the app always uses DEFAULT_TUNING.
 */
export type OptimizeTuning = {
  /** One minute of missed light costs as much as this many seconds of driving. */
  missWeight: number;
  /** Past this many missed minutes a Normal stop's miss counts only `tailSlope` per minute. */
  missCap: number;
  tailSlope: number;
  /** A minute in the dark counts as this many missed-light minutes. */
  darkFactor: number;
  /** When finite, a route whose drive time exceeds this multiple of the shortest drive-only order pays `overSlope` seconds per extra second. */
  driveBudgetRatio: number;
  overSlope: number;
  /** The drive budget used instead (a multiple of the shortest drive) when a High or Must stop has a light preference (Priority focus), so those stops keep most of their strength. Infinity = no budget. */
  priorityBudgetRatio: number;
};
export const DEFAULT_TUNING: OptimizeTuning = { missWeight: 20, missCap: 60, tailSlope: 0.2, darkFactor: 3, driveBudgetRatio: 1.3, overSlope: 4, priorityBudgetRatio: 1.6 };
// How the numbers in DEFAULT_TUNING are used (see OptimizeTuning above for what each one means):
// - missCap/tailSlope: past missCap minutes a Normal stop's miss counts only tailSlope per minute, so a stop that cannot get its light anyway
//   (a golden-hour stop reached at midday) does not keep buying a long detour. High and Must stops are not capped (unless every stop counts the same, under Time focus).
// - darkFactor: a minute in the dark counts as darkFactor missed minutes. For a Normal stop that is 3 x 20 = 60 s of driving per minute
//   (A70 lowered it from 180 s on purpose: the benchmark showed Normal stops buying long detours); High and Must keep their absolute weights below.
/** Seconds of driving one missed minute is worth, per priority. Normal uses missWeight; "must" is large enough that no amount of driving outweighs missing it. */
const PRIORITY_SECONDS_PER_MIN: Record<StopPriority, number | null> = { normal: null, high: 480, must: 60_000 };
/** Time focus: every stop counts the same, so only drive time and missed light decide the route. */
const FLAT_WEIGHT: Record<StopPriority, number> = { normal: 1, high: 1, must: 1 };
const EXACT_MAX_STOPS = 7; // 8 stops (7! orders x ~65 departures) held the event loop for ~0.9 s per request
const STEP_MS = 15 * 60_000;
const DAY_MS = 86_400_000;
const EPS = 1e-9;
/** Cost (seconds of driving) the search must gain before it may change the order the owner already has. */
const CHURN_EPS = 1e-6;

/** Whether the order for `stopCount` stops is provably the best one (exact search), rather than the best a heuristic found. */
export function isExactOptimization(stopCount: number, usesLight: boolean): boolean {
  return usesLight ? stopCount - 1 <= EXACT_MAX_STOPS : stopCount <= EXACT_MAX;
}

type Interval = [number, number];
/** `lightF` / `dayF` hold the same intervals as `light` / `daylight`, flattened to [start, end, start, end, ...] for the hot loop. */
type SunAround = { light: Interval[]; daylight: Interval[]; hasLight: boolean; hasDaylight: boolean; lightF: Float64Array; dayF: Float64Array };

/**
 * Pick the visiting order (stop 0 stays first) and the departure time that minimise
 * drive seconds + 60 x minutes of missed preferred light (Normal stops: at most an hour counts in full) or 3 x that for a visit in the dark.
 * With no light preferences and no visit in the dark this is exactly the shortest-drive order at the default departure.
 * Under the time focus darkness is only reported, never traded against driving.
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
  /** Leave at `preferredDeparture` (else the default) and search only the order: for a trip already under way, whose start cannot move. */
  fixedDeparture?: boolean;
  tuning?: Partial<OptimizeTuning>;
};

function plannedSearch(input: ScheduleInput):
  | { done: Schedule }
  | { steps: (over: () => boolean) => Generator<void, Solution>; finish: (sol: Solution) => Schedule } {
  const { durations, stops, defaultDeparture, preferredDeparture } = input;
  const n = stops.length;
  const d = sanitised(durations);
  const ctx = new Evaluator(d, stops, defaultDeparture.getTime(), preferredDeparture?.getTime(), input.focus, input.fixedDeparture, input.tuning);
  if (n < 2) return { done: { order: optimizeOrder(durations), departAt: defaultDeparture, misses: [], dark: [], timed: false } };
  if (stops.every((s) => s.lightPref === "any")) {
    // Nothing to weigh but driving and darkness: when the shortest order is in daylight at the start in use, it is the answer.
    const order = optimizeOrder(durations);
    const startMs = ctx.candidates[0]!;
    if (input.focus === "time" || !ctx.anyDark(order, startMs)) {
      return { done: { order, departAt: defaultDeparture, misses: [], dark: ctx.darkVisits(order, startMs), timed: false } };
    }
  }
  return {
    steps: (over) => (n - 1 <= EXACT_MAX_STOPS ? exactSteps(ctx, n, over) : localSteps(ctx, n, over)),
    finish: (found) => {
      // Anti-churn (as optimizeOrder has): a different order that scores no better (stops at the same spot, say) is only churn,
      // so keep the order the owner has unless the search found one better by more than a small margin.
      const identity = Array.from({ length: n }, (_, i) => i);
      const keep = found.order.some((v, i) => v !== i) && ctx.cost(identity, found.departMs) <= found.cost + CHURN_EPS;
      const { order, departMs } = keep ? { order: identity, departMs: found.departMs } : found;
      return {
        order,
        departAt:
          departMs === preferredDeparture?.getTime() ? preferredDeparture : departMs === defaultDeparture.getTime() ? defaultDeparture : new Date(departMs),
        misses: ctx.misses(order, departMs),
        dark: ctx.darkVisits(order, departMs),
        timed: true,
      };
    },
  };
}

const flatten = (xs: Interval[]) => {
  const f = new Float64Array(xs.length * 2);
  xs.forEach(([a, b], k) => {
    f[2 * k] = a;
    f[2 * k + 1] = b;
  });
  return f;
};

const sanitised = (durations: number[][]) => durations.map((row) => row.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : PENALTY)));

/** The objective optimizeSchedule minimises, for a given order and departure (for comparing searches). */
export function scheduleCost(input: ScheduleInput, order: number[], departAt: Date): number {
  const ctx = new Evaluator(sanitised(input.durations), input.stops, input.defaultDeparture.getTime(), input.preferredDeparture?.getTime(), input.focus, input.fixedDeparture, input.tuning);
  return ctx.cost(order, departAt.getTime());
}

/** Reference search over every order: slow beyond 8 stops (n! x departures), meant for checking the heuristic in tests. */
export function optimizeScheduleExact(input: ScheduleInput): Schedule {
  const ctx = new Evaluator(sanitised(input.durations), input.stops, input.defaultDeparture.getTime(), input.preferredDeparture?.getTime(), input.focus, input.fixedDeparture, input.tuning);
  const { order, departMs } = exactSearch(ctx, input.stops.length);
  return { order, departAt: new Date(departMs), misses: ctx.misses(order, departMs), dark: ctx.darkVisits(order, departMs), timed: true };
}

class Evaluator {
  readonly candidates: number[];
  private readonly aroundCache: Map<number, SunAround>[];
  private readonly windowCache: Map<number, { light: Interval[]; daylight: Interval | null }>[];
  /** The last day looked up per stop, which nearly every following lookup repeats. */
  private readonly lastDay: number[];
  private readonly lastSun: (SunAround | undefined)[];
  private readonly constrained: boolean[];
  private readonly weight: number[];
  /** Most missed minutes that count against a stop's light (no cap for a high or must stop). */
  private readonly missCap: number[];
  /** Weight of a minute in the dark per stop: its priority weight, none under the time focus (darkness is then only reported). */
  private readonly darkWeight: number[];
  private readonly arrivalOffsets: Float64Array;
  /** Dwell of each stop in ms. */
  readonly dwellMs: number[];
  /** Seconds of driving one missed minute of a Normal stop is worth. */
  readonly missWeight: number;
  /** True when no term of the cost can be negative, so a partial sum that already reaches a threshold can stop early. */
  readonly monotone: boolean;
  private readonly t: OptimizeTuning;
  /** Drive seconds beyond which the route pays extra (Infinity: no budget). */
  private readonly driveBudget: number;

  constructor(
    readonly d: number[][],
    readonly stops: ScheduleStop[],
    defaultMs: number,
    preferredMs?: number,
    focus: "priority" | "time" = "priority",
    fixed = false,
    tuning: Partial<OptimizeTuning> = {},
  ) {
    this.t = { ...DEFAULT_TUNING, ...tuning };
    const prioritised = focus === "priority" && stops.some((s) => s.priority !== "normal" && s.lightPref !== "any");
    const ratio = prioritised ? Math.max(this.t.driveBudgetRatio, this.t.priorityBudgetRatio) : this.t.driveBudgetRatio;
    this.driveBudget = Number.isFinite(ratio) && stops.length > 2 ? ratio * this.drive(optimizeOrder(d)) : Infinity;
    // First wins ties: the preferred departure, then the default, then the grid around the default. A fixed start is the only one.
    this.candidates = fixed ? [preferredMs ?? defaultMs] : preferredMs !== undefined && preferredMs !== defaultMs ? [preferredMs, defaultMs] : [defaultMs];
    for (let t = defaultMs - 3_600_000; !fixed && t <= defaultMs + 14 * 3_600_000; t += STEP_MS) {
      if (t !== defaultMs && t !== preferredMs) this.candidates.push(t);
    }
    this.windowCache = stops.map(() => new Map());
    this.aroundCache = stops.map(() => new Map());
    this.lastDay = stops.map(() => NaN);
    this.lastSun = stops.map(() => undefined);
    this.constrained = stops.map((s) => s.lightPref !== "any");
    // High and Must keep their absolute strength (480 and 60,000 s of driving per missed minute) whatever the Normal weight is.
    const priorityWeight = (p: StopPriority) => (PRIORITY_SECONDS_PER_MIN[p] ?? this.t.missWeight) / this.t.missWeight;
    const weights = focus === "time" ? FLAT_WEIGHT : { normal: priorityWeight("normal"), high: priorityWeight("high"), must: priorityWeight("must") };
    this.weight = stops.map((s) => weights[s.priority ?? "normal"]);
    this.missCap = stops.map((s) => (focus !== "time" && (s.priority === "must" || s.priority === "high") ? Infinity : this.t.missCap));
    this.darkWeight = focus === "time" ? stops.map(() => 0) : this.weight;
    this.arrivalOffsets = new Float64Array(stops.length);
    this.missWeight = this.t.missWeight;
    this.dwellMs = stops.map((s) => s.dwellMinutes * 60_000);
    const nonNegative = (v: number) => Number.isFinite(v) && v >= 0;
    this.monotone =
      d.every((row) => row.every((v) => v >= 0)) &&
      this.weight.every(nonNegative) &&
      this.darkWeight.every(nonNegative) &&
      [this.t.missWeight, this.t.darkFactor, this.t.tailSlope, this.t.overSlope].every(nonNegative) &&
      this.missCap.every((v) => v >= 0);
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

  /** Light windows and daylight (epoch ms) of stop `i` on one solar day (index = days since the epoch); cached. */
  private oneDay(i: number, day: number): { light: Interval[]; daylight: Interval | null } {
    const cache = this.windowCache[i]!;
    let w = cache.get(day);
    if (!w) {
      const s = this.stops[i]!;
      const date = new Date(day * DAY_MS).toISOString().slice(0, 10);
      const light = lightWindows(s.lightPref, getSunWindows(s.lat, s.lng, date)).map(([a, b]) => [a.getTime(), b.getTime()] as Interval);
      const dl = daylightInterval(s.lat, s.lng, date);
      w = { light, daylight: dl ? [dl[0].getTime(), dl[1].getTime()] : null };
      cache.set(day, w);
    }
    return w;
  }

  /**
   * Light windows and daylight (epoch ms) of stop `i` around `arrivalMs`: the solar day it falls on plus the days either side,
   * because just after solar midnight the evening that just ended is nearer than the morning ahead. `hasLight` and `hasDaylight`
   * are the arrival's own day alone: a day without a window (polar) has no light rule, whatever the neighbours have. Cached per day.
   */
  private sunDay(i: number, arrivalMs: number): SunAround {
    const day = Math.floor((arrivalMs + this.stops[i]!.lng * 240_000) / DAY_MS);
    if (day === this.lastDay[i]) return this.lastSun[i]!;
    let w = this.aroundCache[i]!.get(day);
    if (!w) {
      const own = this.oneDay(i, day);
      const before = this.oneDay(i, day - 1);
      const after = this.oneDay(i, day + 1);
      const daylight: Interval[] = [];
      for (const x of [before, own, after]) if (x.daylight) daylight.push(x.daylight);
      // Of the neighbouring days only the window nearest the arrival's day can be the nearest one.
      const light = [...before.light.slice(-1), ...own.light, ...after.light.slice(0, 1)];
      w = { light, daylight, hasLight: own.light.length > 0, hasDaylight: own.daylight !== null, lightF: flatten(light), dayF: flatten(daylight) };
      this.aroundCache[i]!.set(day, w);
    }
    this.lastDay[i] = day;
    this.lastSun[i] = w;
    return w;
  }

  private missAt(i: number, arrivalMs: number): number {
    const { light, hasLight } = this.sunDay(i, arrivalMs);
    if (!hasLight) return 0;
    const end = arrivalMs + this.stops[i]!.dwellMinutes * 60_000;
    let best = Infinity;
    for (const [ws, we] of light) {
      if (end >= ws && arrivalMs <= we) return 0;
      best = Math.min(best, end < ws ? ws - end : arrivalMs - we);
    }
    return best / 60_000;
  }

  /**
   * Minutes between a visit and the nearest daylight (sunrise to sunset, or the stop's own preferred light), 0 when the
   * visit touches either. A day without sunrise or sunset has no daylight rule.
   */
  private darkAt(i: number, arrivalMs: number): number {
    const { light, daylight, hasDaylight } = this.sunDay(i, arrivalMs);
    if (!hasDaylight) return 0;
    const end = arrivalMs + this.stops[i]!.dwellMinutes * 60_000;
    let best = Infinity;
    for (const [a, b] of daylight) {
      if (end >= a && arrivalMs <= b) return 0;
      best = Math.min(best, end < a ? a - end : arrivalMs - b);
    }
    for (const [a, b] of light) {
      if (end >= a && arrivalMs <= b) return 0;
      best = Math.min(best, end < a ? a - end : arrivalMs - b);
    }
    return best / 60_000;
  }

  /** Whether any visit of `order` falls wholly in the dark when leaving at `departMs`. */
  anyDark(order: number[], departMs: number): boolean {
    const off = this.offsets(order);
    return order.some((i, k) => this.darkAt(i, departMs + off[k]!) > 0);
  }

  /** Total missed minutes for `order` when leaving at `departMs`, each stop counted by its priority weight. */
  missTotal(order: number[], departMs: number, off = this.offsets(order)): number {
    let total = 0;
    for (let k = 0; k < order.length; k++) total = this.terms(order[k]!, departMs + off[k]!, total);
    return total;
  }

  /**
   * One visit's share of `missTotal`, added to the running `total`: the light miss (for a stop with a preference) and then the darkness,
   * from one sun lookup. The additions happen in the order missTotal always made them, so partial totals can be reused bit for bit.
   */
  terms(i: number, arrivalMs: number, total: number): number {
    const sun = this.sunDay(i, arrivalMs);
    const end = arrivalMs + this.dwellMs[i]!;
    if (this.constrained[i]) {
      let minutes = 0;
      if (sun.hasLight) {
        const f = sun.lightF;
        let best = Infinity;
        let hit = false;
        for (let k = 0; k < f.length; k += 2) {
          const ws = f[k]!, we = f[k + 1]!;
          if (end >= ws && arrivalMs <= we) {
            hit = true;
            break;
          }
          const v = end < ws ? ws - end : arrivalMs - we;
          if (v < best) best = v;
        }
        minutes = hit ? 0 : best / 60_000;
      }
      total += this.weight[i]! * this.countedMiss(i, minutes);
    }
    if (this.darkWeight[i]) {
      let minutes = 0;
      if (sun.hasDaylight) {
        let best = Infinity;
        let hit = false;
        for (const f of [sun.dayF, sun.lightF]) {
          for (let k = 0; k < f.length; k += 2) {
            const a = f[k]!, b = f[k + 1]!;
            if (end >= a && arrivalMs <= b) {
              hit = true;
              break;
            }
            const v = end < a ? a - end : arrivalMs - b;
            if (v < best) best = v;
          }
          if (hit) break;
        }
        minutes = hit ? 0 : best / 60_000;
      }
      total += this.t.darkFactor * this.darkWeight[i]! * minutes;
    }
    return total;
  }

  /** A miss as it counts against the cost: full up to the cap, then only a trickle (still enough to break ties between hopeless orders). */
  private countedMiss(i: number, minutes: number): number {
    const cap = this.missCap[i]!;
    return minutes <= cap ? minutes : cap + (minutes - cap) * this.t.tailSlope;
  }

  cost(order: number[], departMs: number): number {
    return this.driveCost(order) + this.t.missWeight * this.missTotal(order, departMs);
  }

  /** Drive seconds, plus a surcharge for the part beyond the drive budget (a detour the light does not justify). */
  private driveCost(order: number[]): number {
    return this.driveCostOf(this.drive(order));
  }

  driveCostOf(drive: number): number {
    return drive > this.driveBudget ? drive + this.t.overSlope * (drive - this.driveBudget) : drive;
  }

  /** Best candidate departure for a fixed order (the default wins ties, then the earliest). */
  bestDeparture(order: number[]): { departMs: number; cost: number } {
    const off = this.offsets(order);
    const drive = this.driveCost(order);
    let departMs = this.candidates[0]!;
    let best = Infinity;
    for (const t of this.candidates) {
      const c = this.boundedCost(order, off, drive, t, best - EPS);
      if (c < best - EPS) {
        best = c;
        departMs = t;
      }
    }
    return { departMs, cost: best };
  }

  /**
   * drive + missWeight x missTotal. When no term can be negative it stops adding visits once the sum already reaches `thr` and returns
   * that partial (still >= thr), which is all a caller comparing against `thr` needs to know.
   */
  boundedCost(order: number[], off: Float64Array, drive: number, departMs: number, thr: number): number {
    const mw = this.t.missWeight;
    let total = 0;
    for (let k = 0; k < order.length; k++) {
      total = this.terms(order[k]!, departMs + off[k]!, total);
      if (this.monotone && drive + mw * total >= thr) break;
    }
    return drive + mw * total;
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

  /** The visits of `order` that fall wholly in the dark when leaving at `departMs`. */
  darkVisits(order: number[], departMs: number): ScheduleDark[] {
    const off = this.offsets(order);
    const out: ScheduleDark[] = [];
    order.forEach((i, k) => {
      const minutes = this.darkAt(i, departMs + off[k]!);
      if (minutes > 0) out.push({ stopIndex: i, minutes, priority: this.stops[i]!.priority ?? "normal" });
    });
    return out;
  }
}

type Solution = { order: number[]; departMs: number; cost: number };

/**
 * Every order of stops 1..n-1 against every candidate departure. Yields after each choice of the second stop.
 * The missed-light total of each prefix is carried down the tree per departure (the same left-to-right additions the full sum makes),
 * and a branch is dropped once even its prefix cannot beat the best order found by more than EPS.
 */
function* exactSteps(ctx: Evaluator, n: number, over: () => boolean): Generator<void, Solution> {
  const departs = ctx.candidates;
  const T = departs.length;
  const mw = ctx.missWeight;
  const prune = ctx.monotone;
  let best: Solution = { order: [], departMs: departs[0]!, cost: Infinity };
  const order = [0];
  const used = new Array<boolean>(n).fill(false);
  used[0] = true;
  const missP = new Float64Array(n * T); // missP[k * T + t]: total after the first k + 1 stops when leaving at departs[t]
  const off = new Float64Array(n);
  const driveP = new Float64Array(n);
  for (let t = 0; t < T; t++) missP[t] = ctx.terms(0, departs[t]! + 0, 0);
  /** Add stop `s` at position k; returns the lowest cost any completion of this prefix could still reach. */
  const place = (k: number, prev: number, s: number): number => {
    const leg = ctx.d[prev]![s]!;
    driveP[k] = driveP[k - 1]! + leg;
    off[k] = off[k - 1]! + (leg * 1000 + ctx.dwellMs[prev]!);
    const dc = ctx.driveCostOf(driveP[k]!);
    let lowest = Infinity;
    for (let t = 0; t < T; t++) {
      const m = ctx.terms(s, departs[t]! + off[k]!, missP[(k - 1) * T + t]!);
      missP[k * T + t] = m;
      const v = dc + mw * m;
      if (v < lowest) lowest = v;
    }
    return lowest;
  };
  const visit = () => {
    const k = order.length;
    if (k === n) {
      // The best departure for this order: the default wins ties, then the earliest.
      const dc = ctx.driveCostOf(driveP[n - 1]!);
      let departMs = departs[0]!;
      let cost = Infinity;
      for (let t = 0; t < T; t++) {
        const c = dc + mw * missP[(n - 1) * T + t]!;
        if (c < cost - EPS) {
          cost = c;
          departMs = departs[t]!;
        }
      }
      if (cost < best.cost - EPS) best = { order: [...order], departMs, cost };
      return;
    }
    for (let i = 1; i < n; i++) {
      if (used[i]) continue;
      if (place(k, order[k - 1]!, i) >= best.cost - EPS && prune) continue;
      used[i] = true;
      order.push(i);
      visit();
      order.pop();
      used[i] = false;
    }
  };
  // The first level is unrolled so the generator can pause between its branches.
  for (let first = 1; first < n; first++) {
    if (!(place(1, 0, first) >= best.cost - EPS && prune)) {
      used[first] = true;
      order.push(first);
      visit();
      order.pop();
      used[first] = false;
    }
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
/** Fractions along the departure grid that the seeded descents also start from. */
const SPREAD_DEPARTURES = [0.25, 0.5, 0.75];
/** Larger trips already spend their time budget on the seeded descents and restarts. */
const SPREAD_MAX_STOPS = 12;

/**
 * Extra perturbed restarts after the seeded descents. A fixed count per size so the answer is the same on every machine
 * (the server may additionally stop early on a time budget, see `optimizeScheduleAsync`); each restart costs more as stops
 * are added, so large trips get fewer. Kept modest: this runs on the request thread of a shared server.
 */
const restartsFor = (n: number) => (n <= 12 ? 500 : Math.max(4, Math.floor(150 / n)));

/**
 * Local search: descents from several seeds (nearest-neighbour, window-sorted, must-stops-first, shortest drive), then
 * iterated local search that perturbs the best order with a fixed-seed generator, so the same input gives the same answer.
 */
function* localSteps(ctx: Evaluator, n: number, over: () => boolean): Generator<void, Solution> {
  const seeds = [nearestNeighbour(ctx.d, n), windowSorted(ctx.stops, n), mustFirst(ctx.stops, n), optimizeOrder(ctx.d)];
  let best: Solution | null = null;
  for (const seed of seeds) {
    const sol = yield* improve(ctx, seed);
    if (!best || sol.cost < best.cost - EPS) best = sol;
    yield;
  }
  // Darkness makes the best departure hard to reach from the default one, so small trips also descend from a few evenly spaced others.
  if (n <= SPREAD_MAX_STOPS) {
    for (const f of SPREAD_DEPARTURES) {
      const at = ctx.candidates[Math.floor(f * (ctx.candidates.length - 1))]!;
      for (const seed of seeds) {
        const sol = yield* improve(ctx, seed, at);
        if (sol.cost < best!.cost - EPS) best = sol;
        yield;
      }
      if (over()) return best!;
    }
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
    const sol = yield* improve(ctx, order, r % 4 < 2 ? undefined : ctx.candidates[rand(ctx.candidates.length)]);
    if (sol.cost < best!.cost - EPS) best = sol;
    yield;
  }
  return best!;
}

/**
 * Alternate: move stops around at the current departure (swap / 2-opt / or-opt, first
 * improvement), then re-pick the best departure for the new order, until nothing improves.
 * A neighbour is scored from the first position that differs from the current order, reusing the current order's partial drive,
 * offset and missed-light sums (the same left-to-right additions a full recompute makes), and abandoned once it cannot improve.
 */
function* improve(ctx: Evaluator, start: number[], from?: number): Generator<void, Solution> {
  const n = start.length;
  const d = ctx.d;
  const mw = ctx.missWeight;
  let order = start;
  let { departMs, cost } = from === undefined ? ctx.bestDeparture(order) : { departMs: from, cost: ctx.cost(start, from) };
  const offB = new Float64Array(n);
  const driveB = new Float64Array(n);
  const missB = new Float64Array(n + 1); // missB[k]: missed-light total of the first k stops
  const setBase = () => {
    let t = 0, dr = 0, m = 0;
    for (let k = 0; k < n; k++) {
      if (k > 0) {
        const leg = d[order[k - 1]!]![order[k]!]!;
        dr += leg;
        t += leg * 1000 + ctx.dwellMs[order[k - 1]!]!;
      }
      offB[k] = t;
      driveB[k] = dr;
      m = ctx.terms(order[k]!, departMs + t, m);
      missB[k + 1] = m;
    }
  };
  const cand = new Array<number>(n).fill(0);
  /** Cost of `cand`, which equals `order` before position `m` (m >= 1); a partial >= thr when it cannot beat thr. */
  const score = (m: number, thr: number): number => {
    let dr = driveB[m - 1]!;
    for (let k = m; k < n; k++) dr += d[cand[k - 1]!]![cand[k]!]!;
    const dc = ctx.driveCostOf(dr);
    let t = offB[m - 1]!;
    let total = missB[m]!;
    for (let k = m; k < n; k++) {
      t += d[cand[k - 1]!]![cand[k]!]! * 1000 + ctx.dwellMs[cand[k - 1]!]!;
      total = ctx.terms(cand[k]!, departMs + t, total);
      if (ctx.monotone && dc + mw * total >= thr) break;
    }
    return dc + mw * total;
  };
  /** The first neighbour that beats the current cost (swaps and 2-opt reversals, then or-opt moves of 1-3 stops in either direction); left in `cand`. */
  const findBetter = (): boolean => {
    const thr = cost - EPS;
    for (let k = 0; k < n; k++) cand[k] = order[k]!;
    for (let i = 1; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        cand[i] = order[j]!;
        cand[j] = order[i]!;
        const swapped = score(i, thr);
        if (swapped < thr) return (cost = swapped), true;
        cand[i] = order[i]!;
        cand[j] = order[j]!;
        for (let k = i; k <= j; k++) cand[k] = order[i + j - k]!;
        const reversed = score(i, thr);
        if (reversed < thr) return (cost = reversed), true;
        for (let k = i; k <= j; k++) cand[k] = order[k]!;
      }
    }
    for (let len = 1; len <= 3; len++) {
      for (let i = 1; i + len <= n; i++) {
        for (let pos = 1; pos <= n - len; pos++) {
          if (pos === i) continue;
          for (let flip = 0; flip < (len > 1 ? 2 : 1); flip++) {
            for (let k = 0; k < n; k++) {
              if (k < pos) cand[k] = k < i ? order[k]! : order[k + len]!;
              else if (k < pos + len) cand[k] = order[flip ? i + len - 1 - (k - pos) : i + (k - pos)]!;
              else cand[k] = k - len < i ? order[k - len]! : order[k]!;
            }
            const c = score(Math.min(i, pos), thr);
            if (c < thr) return (cost = c), true;
          }
        }
      }
    }
    return false;
  };
  setBase();
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let moved = false;
    while (findBetter()) {
      order = cand.slice();
      moved = true;
      setBase();
    }
    yield; // a descent at 25 stops can take ~0.2 s: let other work run between rounds
    const re = ctx.bestDeparture(order);
    const shifted = re.departMs !== departMs && re.cost < cost - EPS;
    if (shifted) {
      departMs = re.departMs;
      cost = re.cost;
      setBase();
    }
    if (!moved && !shifted) break;
  }
  return { order, departMs, cost };
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
