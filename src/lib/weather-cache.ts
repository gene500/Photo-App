import { api } from "./api-client";
import { WEATHER_BATCH_MAX } from "./validation";
import type { WeatherForecast } from "./types";

/** A failed lookup is remembered this long so a re-render or reselect doesn't refetch every time. */
export const WEATHER_FAILURE_TTL_MS = 60_000;

/** A forecast is reused this long; after that the next look refetches (forecasts change). */
export const WEATHER_SUCCESS_TTL_MS = 30 * 60_000;

/**
 * Weather is the lowest-priority fetch: while anything holds it (a suggestion search, popularity ranking), weather
 * requests wait and then go out together. A hold that is never released lets go by itself after HOLD_MAX_MS, so
 * a bug elsewhere can only delay weather, never lose it.
 */
export const HOLD_MAX_MS = 45_000;
let holds = 0;
let waiters: (() => void)[] = [];

export function holdWeather(): () => void {
  holds++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(timer);
    holds--;
    if (holds === 0) {
      const ready = waiters;
      waiters = [];
      for (const w of ready) w();
    }
  };
  const timer = setTimeout(release, HOLD_MAX_MS);
  return release;
}

/** Resolves once nothing holds weather. A microtask first, so holds set by a parent's effect (which runs after its children's, in the same flush) are seen. */
export async function whenWeatherIdle(): Promise<void> {
  await Promise.resolve();
  if (holds === 0) return;
  await new Promise<void>((r) => waiters.push(r));
}

// One fetch per place-and-day per session; stops on the same ~1 km grid share it, and the in-flight promise is shared.
const cache = new Map<string, { promise: Promise<WeatherForecast | null>; expiresAt: number }>();

export function forecastKey(lat: number, lng: number, date: string): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}|${date}`;
}

/** Resolves to the day's forecast, or null when the lookup failed (weather is decorative, so never throws). */
export function loadForecast(lat: number, lng: number, date: string): Promise<WeatherForecast | null> {
  const key = forecastKey(lat, lng, date);
  const now = Date.now();
  for (const [k, e] of cache) if (e.expiresAt <= now) cache.delete(k); // evict expired entries so the map cannot grow all session
  const hit = cache.get(key);
  if (hit) return hit.promise;
  const entry = {
    expiresAt: Infinity,
    promise: whenWeatherIdle()
      .then(() => api.weather({ lat, lng, date }))
      .then((r) => {
        const unavailable = !r.forecast.available && r.forecast.reason === "unavailable";
        entry.expiresAt = Date.now() + (unavailable ? WEATHER_FAILURE_TTL_MS : WEATHER_SUCCESS_TTL_MS);
        return r.forecast;
      })
      .catch(() => {
        entry.expiresAt = Date.now() + WEATHER_FAILURE_TTL_MS;
        return null;
      }),
  };
  cache.set(key, entry);
  return entry.promise;
}

/** Weather for several places on one date in as few requests as possible (10 per request, one after another). Unknown = null. */
export async function loadForecastBatch(points: { lat: number; lng: number }[], date: string): Promise<(WeatherForecast | null)[]> {
  await whenWeatherIdle();
  const out: (WeatherForecast | null)[] = points.map(() => null);
  for (let i = 0; i < points.length; i += WEATHER_BATCH_MAX) {
    const chunk = points.slice(i, i + WEATHER_BATCH_MAX);
    try {
      const { forecasts } = await api.weatherBatch(date, chunk);
      chunk.forEach((_, j) => (out[i + j] = forecasts[j] ?? null));
    } catch {
      // Decorative: leave this chunk unknown.
    }
    await whenWeatherIdle(); // a new search started meanwhile takes priority over the next chunk
  }
  return out;
}

/** Entries currently held (for tests). */
export const cacheSize = () => cache.size;

export function resetWeatherCache(): void {
  cache.clear();
  holds = 0;
  waiters = [];
}
