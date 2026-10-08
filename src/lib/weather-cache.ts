import { api } from "./api-client";
import type { WeatherForecast } from "./types";

/** A failed lookup is remembered this long so a re-render or reselect doesn't refetch every time. */
export const WEATHER_FAILURE_TTL_MS = 60_000;

/** A forecast is reused this long; after that the next look refetches (forecasts change). */
export const WEATHER_SUCCESS_TTL_MS = 30 * 60_000;

// One fetch per place-and-day per session; stops on the same ~1 km grid share it, and the in-flight promise is shared.
const cache = new Map<string, { promise: Promise<WeatherForecast | null>; expiresAt: number }>();

export function forecastKey(lat: number, lng: number, date: string): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}|${date}`;
}

/** Resolves to the day's forecast, or null when the lookup failed (weather is decorative, so never throws). */
export function loadForecast(lat: number, lng: number, date: string): Promise<WeatherForecast | null> {
  const key = forecastKey(lat, lng, date);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.promise;
  const entry = {
    expiresAt: Infinity,
    promise: api
      .weather({ lat, lng, date })
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

export function resetWeatherCache(): void {
  cache.clear();
}
