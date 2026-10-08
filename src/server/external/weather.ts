import { inForecastRange, parseOpenMeteo } from "@/lib/weather";
import type { WeatherForecast } from "@/lib/types";
import { fakeWeather, isFakeExternal } from "./fake";
import { PHOTO_USER_AGENT } from "./photo-http";

// Fixed host, no key. Only numbers and a validated date are interpolated into the query.
const API = "https://api.open-meteo.com/v1/forecast";
export const WEATHER_TIMEOUT_MS = 5000;
export const WEATHER_CACHE_MAX = 500;
export const WEATHER_TTL_MS = 30 * 60_000;

/** Same ~1 km grid as the cache key, so every request that shares a key asks upstream for the same point. */
const round2 = (n: number) => n.toFixed(2);

export function weatherCacheKey(lat: number, lng: number, date: string): string {
  return `${round2(lat)},${round2(lng)}|${date}`;
}

export async function fetchForecast(
  lat: number,
  lng: number,
  date: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WeatherForecast> {
  try {
    const params = new URLSearchParams({
      latitude: round2(lat),
      longitude: round2(lng),
      hourly: "cloud_cover,precipitation_probability,temperature_2m",
      timezone: "auto",
      start_date: date,
      end_date: date,
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

/**
 * Forecast lookup with a bounded in-memory LRU (30 min) and in-flight de-duplication. Only real forecasts are
 * cached: a failure is retried on the next request.
 */
export function createForecastLookup(opts: { fetchImpl?: typeof fetch; now?: () => number } = {}) {
  const now = opts.now ?? Date.now;
  const store = new Map<string, { forecast: WeatherForecast; expiresAt: number }>(); // insertion order = recency
  const inFlight = new Map<string, Promise<WeatherForecast>>();

  function lookup(lat: number, lng: number, date: string): Promise<WeatherForecast> {
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
    const p = fetchForecast(lat, lng, date, opts.fetchImpl)
      .then((forecast) => {
        if (forecast.available) {
          store.set(key, { forecast, expiresAt: now() + WEATHER_TTL_MS });
          while (store.size > WEATHER_CACHE_MAX) store.delete(store.keys().next().value as string);
        }
        return forecast;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  }

  return Object.assign(lookup, { size: () => store.size, clear: () => (store.clear(), inFlight.clear()) });
}

const shared = createForecastLookup();

/** Hourly cloud, rain chance and temperature for one day at a point; out-of-horizon dates never reach upstream. */
export async function getForecast(lat: number, lng: number, date: string, today = new Date().toISOString().slice(0, 10)): Promise<WeatherForecast> {
  if (!inForecastRange(date, today)) return { available: false, reason: "out_of_range" };
  if (isFakeExternal()) return fakeWeather({ lat, lng }, date);
  return shared(lat, lng, date);
}
