import { getTimes } from "suncalc";
import type { Place, Stop } from "./types";

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
 * Arrival at each stop = departure + cumulative leg durations (seconds).
 * Legs run start -> stop1 -> ... -> end, so there must be stopCount + 1.
 */
export function estimateArrivals(
  departure: Date,
  legDurations: number[],
  stopCount: number,
): Date[] | null {
  if (legDurations.length !== stopCount + 1) return null;
  const arrivals: Date[] = [];
  let elapsedMs = 0;
  for (let i = 0; i < stopCount; i++) {
    elapsedMs += legDurations[i] * 1000;
    arrivals.push(new Date(departure.getTime() + elapsedMs));
  }
  return arrivals;
}

/** D1: depart at sunrise from the start; ~8 AM solar time when there is no sunrise. */
export function departureTime(start: Place, plannedDate: string): Date {
  const w = getSunWindows(start.lat, start.lng, plannedDate);
  return w.sunrise ?? new Date(solarDayAnchor(plannedDate, start.lng).getTime() - 4 * 3_600_000);
}

export function computeBestTimes(
  trip: { start: Place; plannedDate: string; stops: Pick<Stop, "lat" | "lng">[] },
  legDurations: number[] | null,
): BestTime[] {
  const arrivals = legDurations
    ? estimateArrivals(departureTime(trip.start, trip.plannedDate), legDurations, trip.stops.length)
    : null;
  return trip.stops.map((s, i) =>
    classifyBestTime(getSunWindows(s.lat, s.lng, trip.plannedDate), arrivals?.[i] ?? null),
  );
}

/** "7:45 PM" in the viewer's time zone (or the one given, for tests). */
export function formatClock(date: Date, timeZone?: string): string {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
}

export function describeBestTime(best: BestTime, timeZone?: string): string {
  if (!best) return "No daylight";
  const label = best.window.charAt(0).toUpperCase() + best.window.slice(1);
  return `${label} · ${formatClock(best.at, timeZone)}`;
}
