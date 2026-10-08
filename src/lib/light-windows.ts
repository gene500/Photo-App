import { formatClock, getSunWindows, solarDateAt, type SunWindows } from "./best-time";
import type { SuggestionLightPref, TimeFormat } from "./settings";
import type { LightPref, Stop, SuggestionKind } from "./types";

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

/**
 * When to read the weather for a stop: the middle of the light window the visit is in, else of the nearest one
 * (for golden, the nearer of morning and evening), so a sunset stop reached at 2 pm is judged by the 7 pm sky.
 * Without a preference or any window (polar) it is the arrival itself.
 */
export function forecastInstant(pref: LightPref, lat: number, lng: number, arrival: Date): Date {
  // The previous solar day's windows count too: at 1 am the sunset that just ended is nearer than the one 18 h away.
  const windows = [...windowsForArrival(pref, lat, lng, new Date(arrival.getTime() - 86_400_000)), ...windowsForArrival(pref, lat, lng, arrival)];
  const t = arrival.getTime();
  let best: LightWindow | null = null;
  let bestGap = Infinity;
  for (const w of windows) {
    const gap = t < w[0].getTime() ? w[0].getTime() - t : t > w[1].getTime() ? t - w[1].getTime() : 0;
    if (gap < bestGap) {
      best = w;
      bestGap = gap;
    }
  }
  return best ? new Date((best[0].getTime() + best[1].getTime()) / 2) : arrival;
}

/** New stops from a suggestion start with a sensible light: scenic spots in golden light. */
export function defaultLightPref(kind: SuggestionKind, setting: SuggestionLightPref = "auto"): LightPref {
  if (setting === "any") return "any";
  return kind === "viewpoint" || kind === "peak" ? "golden" : "any";
}

const LIGHT_LABEL: Record<LightPref, string> = { any: "Any", sunrise: "Sunrise", golden: "Golden hour", sunset: "Sunset" };
export const lightLabel = (pref: LightPref) => LIGHT_LABEL[pref];

/** "6:12–7:05 PM": the AM/PM suffix is shown once when both ends share it. */
function clockRange(a: Date, b: Date, timeZone?: string, timeFormat: TimeFormat = "auto"): string {
  const from = formatClock(a, timeZone, timeFormat);
  const to = formatClock(b, timeZone, timeFormat);
  if (timeFormat === "24h") return `${from}–${to}`;
  const suffix = (s: string) => s.slice(-2);
  return suffix(from) === suffix(to) ? `${from.slice(0, -3)}–${to}` : `${from}–${to}`;
}

export type LightHint = { text: string; met: boolean };

/**
 * The row hint for a stop with a preferred light: its window and when we arrive, or by how
 * long the window is missed. null when the stop has no preference, no arrival estimate, or
 * the sun gives no window that day (polar), so the caller falls back to the best-time line.
 */
export function describeLightHint(
  stop: Pick<Stop, "lat" | "lng" | "lightPref" | "dwellMinutes">,
  arrival: Date | null,
  timeZone?: string,
  timeFormat: TimeFormat = "auto",
): LightHint | null {
  if (stop.lightPref === "any" || !arrival) return null;
  const windows = windowsForArrival(stop.lightPref, stop.lat, stop.lng, arrival);
  if (windows.length === 0) return null;
  const label = lightLabel(stop.lightPref);
  const miss = windowMissMinutes(arrival, stop.dwellMinutes, windows);
  if (miss > 0) return { text: `Misses ${label.toLowerCase()} by ${formatMinutes(Math.round(miss))}`, met: false };
  const hit =
    windows.find(([s, e]) => arrival.getTime() + stop.dwellMinutes * MS_MIN >= s.getTime() && arrival.getTime() <= e.getTime()) ??
    windows[0]!;
  return {
    text: `${label} window ${clockRange(hit[0], hit[1], timeZone, timeFormat)} · arrive ${formatClock(arrival, timeZone, timeFormat)}`,
    met: true,
  };
}

function formatMinutes(min: number): string {
  if (min < 90) return `${Math.max(min, 1)} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
