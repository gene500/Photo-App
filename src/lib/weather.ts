import type { LightPref, WeatherForecast, WeatherHour } from "./types";

/** Open-Meteo forecasts reach about 16 days ahead: today through today + 15 (plus yesterday, see inForecastRange). */
export const FORECAST_DAYS = 15;
/** An hour further than this from the asked instant is "no data" rather than a stale guess. */
const MAX_GAP_MS = 90 * 60_000;

const dayNumber = (s: string) => Date.parse(`${s}T00:00:00Z`) / 86_400_000;

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * True when `date` (YYYY-MM-DD) is yesterday through the forecast horizon counted from `today`. Yesterday is
 * allowed because `today` is the server's UTC date, which runs a day ahead of a viewer in the Americas.
 */
export function inForecastRange(date: string, today: string): boolean {
  const diff = dayNumber(date) - dayNumber(today);
  return diff >= -1 && diff <= FORECAST_DAYS;
}

/**
 * The days to request for `date`: the day before through the day after, so a window near midnight (or in a zone far
 * from its longitude's solar time) still finds its hour. Clamped to the range Open-Meteo serves.
 */
export function forecastSpan(date: string, today: string): { start: string; end: string } {
  const lo = addDays(today, -1);
  const hi = addDays(today, FORECAST_DAYS);
  const clamp = (d: string) => (d < lo ? lo : d > hi ? hi : d);
  return { start: clamp(addDays(date, -1)), end: clamp(addDays(date, 1)) };
}

/**
 * The instant of a forecast hour. Open-Meteo (timezone=auto) labels hours in the location's local time with no
 * zone, so the UTC instant is that wall-clock read as UTC minus the location's UTC offset.
 */
export function hourInstant(localTime: string, utcOffsetSeconds: number): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(localTime);
  if (!m) return NaN;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  return Date.UTC(y, mo - 1, d, h, mi) - utcOffsetSeconds * 1000;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Parse an Open-Meteo `/v1/forecast` response (hourly + utc_offset_seconds); anything malformed is unavailable. */
export function parseOpenMeteo(json: unknown): WeatherForecast {
  const unavailable: WeatherForecast = { available: false, reason: "unavailable" };
  if (typeof json !== "object" || json === null) return unavailable;
  const root = json as { utc_offset_seconds?: unknown; hourly?: Record<string, unknown> };
  const offset = num(root.utc_offset_seconds);
  const h = root.hourly;
  if (offset === null || !h || !Array.isArray(h.time)) return unavailable;
  const col = (key: string): unknown[] => (Array.isArray(h[key]) ? (h[key] as unknown[]) : []);
  const cloud = col("cloud_cover");
  const rain = col("precipitation_probability");
  const temp = col("temperature_2m");
  const hours: WeatherHour[] = [];
  h.time.forEach((t, i) => {
    if (typeof t === "string" && Number.isFinite(hourInstant(t, 0))) {
      hours.push({ time: t, cloudPct: num(cloud[i]), rainPct: num(rain[i]), tempC: num(temp[i]) });
    }
  });
  return hours.length > 0 ? { available: true, utcOffsetSeconds: offset, hours } : unavailable;
}

export type WeatherLabel = "Clear" | "Partly cloudy" | "Mostly cloudy" | "Overcast" | "Rain likely";
export type WeatherSummary = { cloudPct: number; rainPct: number; tempC: number | null; label: WeatherLabel };

export function weatherLabel(cloudPct: number, rainPct: number): WeatherLabel {
  if (rainPct >= 50) return "Rain likely";
  if (cloudPct < 20) return "Clear";
  if (cloudPct < 50) return "Partly cloudy";
  if (cloudPct < 80) return "Mostly cloudy";
  return "Overcast";
}

/** Weather at the forecast hour nearest `at` (an ISO instant), or null when no hour with cloud data is within 90 min. */
export function summarizeAt(
  forecast: Extract<WeatherForecast, { available: true }>,
  at: string,
): WeatherSummary | null {
  const target = Date.parse(at);
  if (!Number.isFinite(target)) return null;
  let best: WeatherHour | null = null;
  let bestGap = Infinity;
  for (const hour of forecast.hours) {
    if (hour.cloudPct === null) continue;
    const gap = Math.abs(hourInstant(hour.time, forecast.utcOffsetSeconds) - target);
    if (gap < bestGap) {
      best = hour;
      bestGap = gap;
    }
  }
  if (!best || best.cloudPct === null || bestGap > MAX_GAP_MS) return null;
  const rainPct = best.rainPct ?? 0;
  return { cloudPct: best.cloudPct, rainPct, tempC: best.tempC, label: weatherLabel(best.cloudPct, rainPct) };
}

export type LightQuality = "good" | "fair" | "poor";

/** How well the weather suits the preferred light: clear to partly cloudy is good, overcast or rain is poor. */
export function lightQuality(pref: LightPref, w: Pick<WeatherSummary, "cloudPct" | "rainPct">): LightQuality | null {
  if (pref === "any") return null;
  if (w.rainPct >= 50 || w.cloudPct >= 80) return "poor";
  return w.cloudPct < 50 ? "good" : "fair";
}

/** "mostly cloudy, 15% rain" (lower case, to follow the light window in a hint). */
export function describeWeather(w: WeatherSummary): string {
  if (w.label === "Rain likely") return `rain likely (${Math.round(w.rainPct)}%)`;
  return `${w.label.toLowerCase()}, ${Math.round(w.rainPct)}% rain`;
}

export const FORECAST_UNAVAILABLE_TEXT = "Forecast not available yet";
