import { addDays, forecastSpan, inForecastRange, inTypicalRange, parseOpenMeteo } from "@/lib/weather";
import type { WeatherForecast } from "@/lib/types";
import { fakeWeather, isFakeExternal } from "./fake";
import { PHOTO_USER_AGENT } from "./photo-http";
import { round2, sharedTypical } from "./typical-weather";

// Fixed host, no key. Only numbers and a validated date are interpolated into the query.
const API = "https://api.open-meteo.com/v1/forecast";
export const WEATHER_TIMEOUT_MS = 5000;
export const WEATHER_CACHE_MAX = 500;
export const WEATHER_TTL_MS = 30 * 60_000;
/** An upstream failure is remembered briefly so a flapping Open-Meteo is not hammered. */
export const WEATHER_FAILURE_TTL_MS = 60_000;

export function weatherCacheKey(lat: number, lng: number, date: string): string {
  return `${round2(lat)},${round2(lng)}|${date}`;
}

export async function fetchForecast(
  lat: number,
  lng: number,
  start: string,
  end: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WeatherForecast> {
  try {
    const params = new URLSearchParams({
      latitude: round2(lat),
      longitude: round2(lng),
      hourly: "cloud_cover,precipitation_probability,temperature_2m",
      timezone: "auto",
      start_date: start,
      end_date: end,
    });
    const res = await fetchImpl(`${API}?${params}`, {
      headers: { "User-Agent": PHOTO_USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(WEATHER_TIMEOUT_MS),
    });
    if (!res.ok) return { available: false, reason: "unavailable" };
    return parseOpenMeteo(await res.json());
  } catch {
    return { available: false, reason: "unavailable" };
  }
}

/** One request for several points (Open-Meteo takes comma-separated coordinates and answers with an array). */
export async function fetchForecastMany(
  points: { lat: number; lng: number }[],
  start: string,
  end: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WeatherForecast[]> {
  const failed = points.map((): WeatherForecast => ({ available: false, reason: "unavailable" }));
  try {
    const params = new URLSearchParams({
      latitude: points.map((p) => round2(p.lat)).join(","),
      longitude: points.map((p) => round2(p.lng)).join(","),
      hourly: "cloud_cover,precipitation_probability,temperature_2m",
      timezone: "auto",
      start_date: start,
      end_date: end,
    });
    const res = await fetchImpl(`${API}?${params}`, {
      headers: { "User-Agent": PHOTO_USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(WEATHER_TIMEOUT_MS),
    });
    if (!res.ok) return failed;
    const json: unknown = await res.json();
    const list = Array.isArray(json) ? json : [json];
    return list.length === points.length ? list.map(parseOpenMeteo) : failed;
  } catch {
    return failed;
  }
}

/**
 * Forecast lookup with a bounded in-memory LRU (30 min) and in-flight de-duplication. Only real forecasts are
 * cached for 30 min; an unavailable answer for 60 s.
 */
export function createForecastLookup(opts: { fetchImpl?: typeof fetch; now?: () => number } = {}) {
  const now = opts.now ?? Date.now;
  const store = new Map<string, { forecast: WeatherForecast; expiresAt: number }>(); // insertion order = recency
  const inFlight = new Map<string, Promise<WeatherForecast>>();

  function lookup(lat: number, lng: number, date: string, today = new Date().toISOString().slice(0, 10)): Promise<WeatherForecast> {
    const key = weatherCacheKey(lat, lng, date);
    const hit = store.get(key);
    if (hit) {
      store.delete(key);
      if (hit.expiresAt > now()) {
        store.set(key, hit); // refresh recency
        return Promise.resolve(hit.forecast);
      }
    }
    const pending = inFlight.get(key);
    if (pending) return pending;
    const span = forecastSpan(date, today);
    const p = fetchForecast(lat, lng, span.start, span.end, opts.fetchImpl)
      .then((forecast) => {
        store.set(key, { forecast, expiresAt: now() + (forecast.available ? WEATHER_TTL_MS : WEATHER_FAILURE_TTL_MS) });
        while (store.size > WEATHER_CACHE_MAX) store.delete(store.keys().next().value as string);
        return forecast;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  }

  /** Several points for one date: cached ones are served from memory, the rest share a single upstream request. */
  function many(points: { lat: number; lng: number }[], date: string, today = new Date().toISOString().slice(0, 10)): Promise<WeatherForecast[]> {
    const out: Promise<WeatherForecast>[] = new Array(points.length);
    const missing = new Map<string, { point: { lat: number; lng: number }; slots: number[] }>();
    points.forEach((p, i) => {
      const key = weatherCacheKey(p.lat, p.lng, date);
      const hit = store.get(key);
      if (hit && hit.expiresAt > now()) {
        store.delete(key);
        store.set(key, hit);
        out[i] = Promise.resolve(hit.forecast);
        return;
      }
      const pending = inFlight.get(key);
      if (pending) {
        out[i] = pending;
        return;
      }
      const e = missing.get(key) ?? { point: p, slots: [] };
      e.slots.push(i);
      missing.set(key, e);
    });
    if (missing.size > 0) {
      const entries = [...missing.entries()];
      const span = forecastSpan(date, today);
      const batch = fetchForecastMany(entries.map(([, e]) => e.point), span.start, span.end, opts.fetchImpl);
      entries.forEach(([key, e], j) => {
        const p = batch
          .then((list) => {
            const forecast = list[j];
            store.set(key, { forecast, expiresAt: now() + (forecast.available ? WEATHER_TTL_MS : WEATHER_FAILURE_TTL_MS) });
            while (store.size > WEATHER_CACHE_MAX) store.delete(store.keys().next().value as string);
            return forecast;
          })
          .finally(() => inFlight.delete(key));
        inFlight.set(key, p);
        for (const slot of e.slots) out[slot] = p;
      });
    }
    return Promise.all(out);
  }

  return Object.assign(lookup, { many, size: () => store.size, clear: () => (store.clear(), inFlight.clear()) });
}

const shared = createForecastLookup();

/**
 * Hourly cloud, rain chance and temperature around one day (the day before through the day after) at a point.
 * Beyond the forecast horizon (up to TYPICAL_MAX_DAYS) it answers with typical weather for that calendar date,
 * marked `typical`; anything else out of range never reaches upstream.
 */
export async function getForecast(lat: number, lng: number, date: string, today = new Date().toISOString().slice(0, 10)): Promise<WeatherForecast> {
  return (await getForecasts([{ lat, lng }], date, today))[0];
}

/** getForecast for up to a handful of points at once, sharing upstream requests. */
export async function getForecasts(points: { lat: number; lng: number }[], date: string, today = new Date().toISOString().slice(0, 10)): Promise<WeatherForecast[]> {
  const inRange = inForecastRange(date, today);
  if (!inRange && !inTypicalRange(date, today)) return points.map((): WeatherForecast => ({ available: false, reason: "out_of_range" }));
  if (isFakeExternal()) {
    const { start, end } = inRange ? forecastSpan(date, today) : { start: addDays(date, -1), end: addDays(date, 1) };
    return points.map((p) => {
      const f = fakeWeather(p, start, end);
      return inRange ? f : { ...f, typical: true as const };
    });
  }
  return inRange ? shared.many(points, date, today) : sharedTypical(points, date, today);
}
