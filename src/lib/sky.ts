import { getMoonIllumination, getMoonTimes, getPosition } from "suncalc";
import { getSunWindows, solarDayAnchor } from "./best-time";

export type MoonPhaseName =
  | "new moon"
  | "waxing crescent"
  | "first quarter"
  | "waxing gibbous"
  | "full moon"
  | "waning gibbous"
  | "last quarter"
  | "waning crescent";

/** `bearing` is compass degrees clockwise from north, 0 up to (not including) 360. */
export type SkyEvent = { bearing: number; at: Date };

export type SkyInfo = {
  /** null when the sun does not rise that day (polar day or night). */
  sunrise: SkyEvent | null;
  sunset: SkyEvent | null;
  alwaysUp: boolean;
  alwaysDown: boolean;
  moon: { phase: MoonPhaseName; illuminationPct: number; rise: Date | null };
};

const MOON_PHASES: MoonPhaseName[] = [
  "new moon",
  "waxing crescent",
  "first quarter",
  "waxing gibbous",
  "full moon",
  "waning gibbous",
  "last quarter",
  "waning crescent",
];

const COMPASS_POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

/**
 * Converts a south-based, westward azimuth in radians (suncalc v1 and the textbook formula) to a compass bearing.
 * The installed suncalc v2 already returns north-based degrees, so getSkyInfo uses normalizeBearing instead.
 */
export function azimuthToBearing(azimuthRad: number): number {
  return normalizeBearing((azimuthRad * 180) / Math.PI + 180);
}

/** Wraps degrees into [0, 360). */
function normalizeBearing(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/** 16-point compass word for a bearing in degrees. */
export function compassWord(bearing: number): string {
  return COMPASS_POINTS[Math.round(normalizeBearing(bearing) / 22.5) % 16]!;
}

/** suncalc moon phase (0 = new, 0.5 = full, back to 1 = new) as one of eight names. */
export function moonPhaseName(phase: number): MoonPhaseName {
  return MOON_PHASES[Math.round(phase * 8) % 8]!;
}

function skyEvent(at: Date | null, lat: number, lng: number): SkyEvent | null {
  if (!at) return null;
  return { bearing: normalizeBearing(getPosition(at, lat, lng).azimuth), at };
}

/**
 * Where the sun rises and sets, and the moon's phase, for the stop's local solar day.
 * suncalc v2's getMoonTimes scans the same 24 hours from solar nadir that getTimes uses,
 * so handing it the solar-day anchor covers exactly the day the sun times describe.
 */
export function getSkyInfo(lat: number, lng: number, plannedDate: string): SkyInfo {
  const sun = getSunWindows(lat, lng, plannedDate);
  const anchor = solarDayAnchor(plannedDate, lng);
  const illumination = getMoonIllumination(anchor);
  return {
    sunrise: skyEvent(sun.sunrise, lat, lng),
    sunset: skyEvent(sun.sunset, lat, lng),
    alwaysUp: sun.alwaysUp,
    alwaysDown: sun.alwaysDown,
    moon: {
      phase: moonPhaseName(illumination.phase),
      illuminationPct: Math.round(illumination.fraction * 100),
      rise: getMoonTimes(anchor, lat, lng).rise ?? null,
    },
  };
}
