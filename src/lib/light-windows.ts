import { getSunWindows, solarDateAt, type SunWindows } from "./best-time";
import type { LightPref } from "./types";

export type LightWindow = [start: Date, end: Date];

const MS_MIN = 60_000;
const SUNRISE_LEAD = 20 * MS_MIN;
const SUNSET_TAIL = 20 * MS_MIN;

/**
 * The times of one day when a stop's preferred light is good.
 *   sunrise: 20 min before sunrise until the end of morning golden hour
 *   sunset:  start of evening golden hour until 20 min after sunset
 *   golden:  both
 *   any:     no constraint
 * Missing sun times (polar day or night) mean no constraint, so the list is empty.
 */
export function lightWindows(pref: LightPref, sun: SunWindows): LightWindow[] {
  const out: LightWindow[] = [];
  if ((pref === "sunrise" || pref === "golden") && sun.sunrise && sun.goldenHourEnd) {
    out.push([new Date(sun.sunrise.getTime() - SUNRISE_LEAD), sun.goldenHourEnd]);
  }
  if ((pref === "sunset" || pref === "golden") && sun.goldenHour && sun.sunset) {
    out.push([sun.goldenHour, new Date(sun.sunset.getTime() + SUNSET_TAIL)]);
  }
  return out;
}

/**
 * 0 when the visit [arrival, arrival + dwell] overlaps a window (or there are none);
 * otherwise the minutes between the visit and the nearest window.
 */
export function windowMissMinutes(arrival: Date, dwellMinutes: number, windows: LightWindow[]): number {
  if (windows.length === 0) return 0;
  const start = arrival.getTime();
  const end = start + dwellMinutes * MS_MIN;
  let best = Infinity;
  for (const [ws, we] of windows) {
    if (end >= ws.getTime() && start <= we.getTime()) return 0;
    best = Math.min(best, end < ws.getTime() ? ws.getTime() - end : start - we.getTime());
  }
  return best / MS_MIN;
}

/** Light windows for a stop on the solar day its arrival falls on (so multi-day drives work). */
export function windowsForArrival(pref: LightPref, lat: number, lng: number, arrival: Date): LightWindow[] {
  if (pref === "any") return [];
  return lightWindows(pref, getSunWindows(lat, lng, solarDateAt(arrival, lng)));
}
