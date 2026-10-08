import { getTimes } from "suncalc";
import type { TimeFormat } from "./settings";
import type { Stop } from "./types";

export type BestTimeWindow = "sunrise" | "golden hour" | "midday" | "sunset";

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

export function getSunWindows(lat: number, lng: number, plannedDate: string): SunWindows {
  const t = getTimes(solarDayAnchor(plannedDate, lng), lat, lng);
  return {
    sunrise: t.sunrise,
    goldenHourEnd: t.goldenHourEnd,
    solarNoon: t.solarNoon,
    goldenHour: t.goldenHour,
    sunset: t.sunset,
    alwaysUp: t.alwaysUp === true,
    alwaysDown: t.alwaysDown === true,
  };
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
 */
export function estimateArrivals(
  departure: Date,
  legDurations: number[],
  stopCount: number,
  dwellMinutes: number[] = [],
): Date[] | null {
  if (stopCount === 0) return [];
  if (legDurations.length !== stopCount - 1) return null;
  const arrivals: Date[] = [departure];
  let elapsedMs = 0;
  legDurations.forEach((seconds, i) => {
    elapsedMs += seconds * 1000 + (dwellMinutes[i] ?? 0) * 60_000;
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
  stops: Pick<Stop, "lat" | "lng" | "dwellMinutes">[];
};

/** When the trip leaves its first stop: the chosen departure, else sunrise there. */
export function tripDeparture(trip: TripForTimes): Date {
  if (trip.departAt) return new Date(trip.departAt);
  return departureTime(trip.stops[0]!, trip.plannedDate);
}

/** Estimated arrival per stop, or nulls when there are fewer than 2 stops or no matching route. */
export function computeArrivals(trip: TripForTimes, legDurations: number[] | null): (Date | null)[] {
  const none = trip.stops.map(() => null);
  if (!legDurations || trip.stops.length < 2) return none;
  return (
    estimateArrivals(tripDeparture(trip), legDurations, trip.stops.length, trip.stops.map((s) => s.dwellMinutes)) ?? none
  );
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
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone, hourCycle });
}

export function describeBestTime(best: BestTime, timeZone?: string, timeFormat: TimeFormat = "auto"): string {
  if (!best) return "No daylight";
  const label = best.window.charAt(0).toUpperCase() + best.window.slice(1);
  return `${label} · ${formatClock(best.at, timeZone, timeFormat)}`;
}
