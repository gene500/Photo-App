import { enUsFormatter } from "./intl-cache";
import { getTimes } from "suncalc";
import type { TimeFormat } from "./settings";
import type { Stop } from "./types";
import { stopWalkMinutes, walkMs } from "./walk-time";

type BestTimeWindow = "sunrise" | "golden hour" | "midday" | "sunset";

/** null means the sun never rises that day at that spot (polar night). */
export type BestTime = { window: BestTimeWindow; at: Date } | null;

export type SunWindows = {
  sunrise: Date | null;
  /** End of morning golden hour. */
  goldenHourEnd: Date | null;
  solarNoon: Date;
  /** Start of evening golden hour. */
  goldenHour: Date | null;
  sunset: Date | null;
  alwaysUp: boolean;
  alwaysDown: boolean;
};

/**
 * An instant at local solar noon of `plannedDate` at longitude `lng`.
 * suncalc v2 returns times for the local solar day containing the instant it
 * is given, so passing UTC midnight would pick the wrong day far from Greenwich.
 */
export function solarDayAnchor(plannedDate: string, lng: number): Date {
  const [y, m, d] = plannedDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12) - lng * 4 * 60_000);
}

/** The local solar calendar date (YYYY-MM-DD) at longitude `lng` at instant `at`. */
export function solarDateAt(at: Date, lng: number): string {
  return new Date(at.getTime() + lng * 4 * 60_000).toISOString().slice(0, 10);
}

/**
 * `at`, or the nearest whole-minute instant on the solar day of `plannedDate` at `lng` when it falls on a neighbouring
 * day. The trips API refuses a start time that is not on its planned day, and a search (or a stale saved value) can land
 * just across midnight at high latitude.
 */
export function clampToSolarDay(at: Date, plannedDate: string, lng: number): Date {
  const noon = solarDayAnchor(plannedDate, lng).getTime();
  const first = Math.ceil((noon - 12 * 3_600_000) / 60_000) * 60_000;
  const last = Math.floor((noon + 12 * 3_600_000 - 1) / 60_000) * 60_000;
  const t = at.getTime();
  return t >= first && t <= last && solarDateAt(at, lng) === plannedDate ? at : new Date(Math.min(Math.max(t, first), last));
}

const SUN_MEMO_MAX = 500;
const sunMemo = new Map<string, SunWindows>();
const copyDate = (d: Date | null): Date | null => (d ? new Date(d.getTime()) : d);

/**
 * Sun times for a spot and solar day. Pure in (lat, lng, plannedDate), and the same spot and day are asked for over and over (every render,
 * every stop, three solar days each), so the answer is remembered (the 500 most recently added keys; the oldest is dropped first). Callers get their own Date objects each time.
 */
export function getSunWindows(lat: number, lng: number, plannedDate: string): SunWindows {
  const key = `${lat},${lng},${plannedDate}`;
  let w = sunMemo.get(key);
  if (!w) {
    const t = getTimes(solarDayAnchor(plannedDate, lng), lat, lng);
    w = {
      sunrise: t.sunrise,
      goldenHourEnd: t.goldenHourEnd,
      solarNoon: t.solarNoon,
      goldenHour: t.goldenHour,
      sunset: t.sunset,
      alwaysUp: t.alwaysUp === true,
      alwaysDown: t.alwaysDown === true,
    };
    if (sunMemo.size >= SUN_MEMO_MAX) sunMemo.delete(sunMemo.keys().next().value!);
    sunMemo.set(key, w);
  }
  return {
    sunrise: copyDate(w.sunrise),
    goldenHourEnd: copyDate(w.goldenHourEnd),
    solarNoon: new Date(w.solarNoon.getTime()),
    goldenHour: copyDate(w.goldenHour),
    sunset: copyDate(w.sunset),
    alwaysUp: w.alwaysUp,
    alwaysDown: w.alwaysDown,
  };
}

/**
 * Sunrise to sunset of the solar day `plannedDate` at the spot, or null when the sun does not rise and set that day
 * (polar day or night), where no daylight rule applies.
 */
export function daylightInterval(lat: number, lng: number, plannedDate: string): [Date, Date] | null {
  const { sunrise, sunset } = getSunWindows(lat, lng, plannedDate);
  return sunrise && sunset && !Number.isNaN(sunrise.getTime()) && !Number.isNaN(sunset.getTime()) ? [sunrise, sunset] : null;
}

/**
 * D1: pick the shooting window from the estimated arrival time.
 *   before morning golden hour ends -> sunrise
 *   before evening golden hour      -> midday
 *   before sunset                   -> golden hour
 *   after sunset                    -> sunset (the window just missed, so the user can re-plan)
 * With no arrival estimate, default to evening golden hour.
 */
export function classifyBestTime(w: SunWindows, arrival: Date | null): BestTime {
  if (w.alwaysDown) return null;
  if (w.alwaysUp || !w.sunrise || !w.sunset) return { window: "midday", at: w.solarNoon };
  const eveningStart = w.goldenHour ?? w.solarNoon;
  if (!arrival) return { window: "golden hour", at: eveningStart };
  const morningEnd = w.goldenHourEnd ?? w.solarNoon;
  const t = arrival.getTime();
  if (t < morningEnd.getTime()) return { window: "sunrise", at: w.sunrise };
  if (t < eveningStart.getTime()) return { window: "midday", at: w.solarNoon };
  if (t < w.sunset.getTime()) return { window: "golden hour", at: eveningStart };
  return { window: "sunset", at: w.sunset };
}

/**
 * Arrival at each stop. The first stop is the departure point; each later stop is
 * departure + cumulative leg durations (seconds) + the minutes spent at every earlier
 * stop. Legs run stop1 -> stop2 -> ..., so there must be stopCount - 1 of them.
 * `dwellMinutes[i]` is the time spent at stop i (missing = 0).
 * `walkMinutes[i]` is the one-way walk from stop i's parking lot to its subject (missing = 0): the dwell is spent at the subject,
 * so the lot is left dwell + 2 x walk after arriving at it. The dates returned are arrivals at the lot (at the stop itself without one).
 */
export function estimateArrivals(
  departure: Date,
  legDurations: number[],
  stopCount: number,
  dwellMinutes: number[] = [],
  walkMinutes: number[] = [],
): Date[] | null {
  if (stopCount === 0) return [];
  if (legDurations.length !== stopCount - 1) return null;
  const arrivals: Date[] = [departure];
  let elapsedMs = 0;
  legDurations.forEach((seconds, i) => {
    elapsedMs += seconds * 1000 + (dwellMinutes[i] ?? 0) * 60_000 + 2 * walkMs(walkMinutes[i]);
    arrivals.push(new Date(departure.getTime() + elapsedMs));
  });
  return arrivals;
}

/** D1: depart at sunrise from the first stop; ~8 AM solar time when there is no sunrise. */
export function departureTime(first: Pick<Stop, "lat" | "lng">, plannedDate: string): Date {
  const w = getSunWindows(first.lat, first.lng, plannedDate);
  return w.sunrise ?? new Date(solarDayAnchor(plannedDate, first.lng).getTime() - 4 * 3_600_000);
}

type TripForTimes = {
  plannedDate: string;
  /** ISO instant the trip leaves the first stop; null/absent = sunrise at the first stop. */
  departAt?: string | null;
  stops: (Pick<Stop, "lat" | "lng" | "dwellMinutes"> & { access?: { walkMeters?: number | null } | null })[];
};

/** When the trip leaves its first stop: the chosen departure, else sunrise there. */
export function tripDeparture(trip: TripForTimes): Date {
  if (trip.departAt) return new Date(trip.departAt);
  return departureTime(trip.stops[0]!, trip.plannedDate);
}

/** Estimated arrival at each stop's lot (at the stop itself without one), or nulls when there are fewer than 2 stops or no matching route. The first is the start time. */
export function computeLotArrivals(trip: TripForTimes, legDurations: number[] | null): (Date | null)[] {
  const none = trip.stops.map(() => null);
  if (!legDurations || trip.stops.length < 2) return none;
  return (
    estimateArrivals(tripDeparture(trip), legDurations, trip.stops.length, trip.stops.map((s) => s.dwellMinutes), trip.stops.map(stopWalkMinutes)) ?? none
  );
}

/**
 * Estimated arrival at each stop's subject: the lot arrival plus the one-way walk (the same as the lot arrival for a stop without a lot).
 * This is the time light, best-time windows and "Arrive" lines use. Nulls when there are fewer than 2 stops or no matching route.
 */
export function computeArrivals(trip: TripForTimes, legDurations: number[] | null): (Date | null)[] {
  return computeLotArrivals(trip, legDurations).map((d, i) => (d ? new Date(d.getTime() + walkMs(stopWalkMinutes(trip.stops[i]!))) : null));
}

export function computeBestTimes(trip: TripForTimes, legDurations: number[] | null): BestTime[] {
  const arrivals = computeArrivals(trip, legDurations);
  return trip.stops.map((s, i) => {
    const arrival = arrivals[i] ?? null;
    // On a multi-day drive a stop's sun times are those of the day the arrival falls on.
    const day = arrival ? solarDateAt(arrival, s.lng) : trip.plannedDate;
    return classifyBestTime(getSunWindows(s.lat, s.lng, day), arrival);
  });
}

/** "7:45 PM" in the viewer's time zone (or the one given, for tests); "19:45" for 24h, "auto" is the 12-hour default. */
export function formatClock(date: Date, timeZone?: string, timeFormat: TimeFormat = "auto"): string {
  const hourCycle = timeFormat === "24h" ? "h23" : timeFormat === "12h" ? "h12" : undefined;
  // An invalid Date: toLocaleTimeString answers "Invalid Date" where DateTimeFormat.format would throw.
  if (Number.isNaN(date.getTime())) return "Invalid Date";
  return enUsFormatter(`clock|${timeZone}|${hourCycle}`, { hour: "numeric", minute: "2-digit", timeZone, hourCycle }).format(date);
}

export function describeBestTime(best: BestTime, timeZone?: string, timeFormat: TimeFormat = "auto"): string {
  if (!best) return "No daylight";
  const label = best.window.charAt(0).toUpperCase() + best.window.slice(1);
  return `${label} · ${formatClock(best.at, timeZone, timeFormat)}`;
}
