"use client";

import { useEffect, useState } from "react";
import { solarDateAt } from "./best-time";
import type { LightPref, WeatherForecast } from "./types";
import { describeWeather, FORECAST_UNAVAILABLE_TEXT, inForecastRange, lightQuality, summarizeAt, type LightQuality } from "./weather";
import { loadForecast } from "./weather-cache";

export type WeatherLine = { text: string; quality: LightQuality | null };

/** The pure part: the hint text for an instant given the day's forecast (null = say nothing). */
export function weatherLine(forecast: WeatherForecast | null, pref: LightPref, at: Date): WeatherLine | null {
  if (!forecast) return null;
  if (!forecast.available) {
    return forecast.reason === "out_of_range" ? { text: FORECAST_UNAVAILABLE_TEXT, quality: null } : null;
  }
  const w = summarizeAt(forecast, at.toISOString());
  return w ? { text: describeWeather(w), quality: lightQuality(pref, w) } : null;
}

/**
 * Lazily fetched weather for a place at an instant, e.g. a stop's arrival. null while loading, when `at` is
 * missing, or when the lookup failed: weather is decorative and never blocks the UI. Dates outside the forecast
 * horizon answer "Forecast not available yet" without a request.
 */
export function useWeatherLine(lat: number, lng: number, at: Date | null, pref: LightPref = "any"): WeatherLine | null {
  const atMs = at ? at.getTime() : null;
  const date = atMs === null ? null : solarDateAt(new Date(atMs), lng);
  const inRange = date !== null && inForecastRange(date, new Date().toISOString().slice(0, 10));
  const key = date === null ? null : `${lat.toFixed(2)},${lng.toFixed(2)}|${date}`;
  const [loaded, setLoaded] = useState<{ key: string; forecast: WeatherForecast | null } | null>(null);
  useEffect(() => {
    if (key === null || date === null || !inRange) return;
    let current = true;
    void loadForecast(lat, lng, date).then((forecast) => {
      if (current) setLoaded({ key, forecast });
    });
    return () => {
      current = false;
    };
  }, [key, date, inRange, lat, lng]);
  if (atMs === null || key === null) return null;
  if (date !== null && !inRange) {
    // Too far ahead is "not yet"; a day already gone has no forecast to wait for, so say nothing.
    return date > new Date().toISOString().slice(0, 10) ? { text: FORECAST_UNAVAILABLE_TEXT, quality: null } : null;
  }
  return loaded?.key === key ? weatherLine(loaded.forecast, pref, new Date(atMs)) : null;
}
