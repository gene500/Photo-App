"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getSunWindows, solarDateAt } from "./best-time";
import { forecastInstant } from "./light-windows";
import type { LightPref, WeatherForecast } from "./types";
import { describeTypical, describeWeather, weatherGlyph, FORECAST_UNAVAILABLE_TEXT, inForecastRange, inTypicalRange, lightQuality, summarizeAt, type LightQuality } from "./weather";
import { useSettings } from "@/components/settings/SettingsProvider";
import { loadForecast, loadForecastBatch } from "./weather-cache";

/** `text` is the short emoji + temperature; `label` is the same in words (tooltip and screen readers). */
export type WeatherLine = { text: string; label?: string; quality: LightQuality | null };
type Unit = "km" | "mi";

/** The pure part: the hint text for an instant given the day's forecast (null = say nothing). */
export function weatherLine(forecast: WeatherForecast | null, pref: LightPref, at: Date, unit: Unit = "km"): WeatherLine | null {
  if (!forecast) return null;
  if (!forecast.available) {
    return forecast.reason === "out_of_range" ? { text: FORECAST_UNAVAILABLE_TEXT, quality: null } : null;
  }
  const w = summarizeAt(forecast, at.toISOString());
  if (!w) return null;
  const glyph = weatherGlyph(w, unit);
  return forecast.typical
    ? { text: `Typical ${glyph}`, label: describeTypical(w).replace(/^./, (c) => c.toUpperCase()), quality: lightQuality(pref, w) }
    : { text: glyph, label: describeWeather(w), quality: lightQuality(pref, w) };
}

/**
 * Lazily fetched weather for a stop: read at the middle of its preferred light window (see forecastInstant), or at
 * `arrival` itself when the preference is "any" or the sun gives no window. null while loading, when there is
 * no arrival, or when the lookup failed: weather is decorative and never blocks the UI. Dates outside the forecast
 * horizon answer "Forecast not available yet" without a request.
 */
export function useWeatherLine(lat: number, lng: number, arrival: Date | null, pref: LightPref = "any"): WeatherLine | null {
  const unit = useSettings().settings.distanceUnit;
  const atMs = arrival ? forecastInstant(pref, lat, lng, arrival).getTime() : null;
  const date = atMs === null ? null : solarDateAt(new Date(atMs), lng);
  const today = new Date().toISOString().slice(0, 10);
  const inRange = date !== null && (inForecastRange(date, today) || inTypicalRange(date, today));
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
    return date > today ? { text: FORECAST_UNAVAILABLE_TEXT, quality: null } : null;
  }
  return loaded?.key === key ? weatherLine(loaded.forecast, pref, new Date(atMs), unit) : null;
}

/** Suggestion weather is requested for this many places at a time, from the top of the list down. */
export const SUGGESTION_WEATHER_GROUP = 5;

type Spot = { osmId: string; lat: number; lng: number };

/**
 * Weather lines for suggestion cards, read at the middle of each place's golden hour on the trip date. Everything is
 * fetched in batches and only while `enabled`, which the editor turns on once the suggestions themselves (and their
 * popularity ranking) have finished loading: weather is the last thing fetched.
 */
export function useSuggestionWeather(spots: readonly Spot[], plannedDate: string | null, enabled: boolean): ReadonlyMap<string, WeatherLine> {
  const unit = useSettings().settings.distanceUnit;
  const today = new Date().toISOString().slice(0, 10);
  const targets = useMemo(() => {
    const out = new Map<string, { at: Date; date: string; spot: Spot }>();
    if (plannedDate === null) return out;
    for (const spot of spots) {
      const golden = getSunWindows(spot.lat, spot.lng, plannedDate).goldenHour;
      if (!(golden instanceof Date) || Number.isNaN(golden.getTime())) continue;
      const at = forecastInstant("golden", spot.lat, spot.lng, golden);
      const date = solarDateAt(at, spot.lng);
      if (inForecastRange(date, today) || inTypicalRange(date, today)) out.set(spot.osmId, { at, date, spot });
    }
    return out;
  }, [spots, plannedDate, today]);
  const [forecasts, setForecasts] = useState<ReadonlyMap<string, WeatherForecast | null>>(new Map());
  const requested = useRef(new Set<string>());
  useEffect(() => {
    if (!enabled) return;
    // In list order (best first), five at a time, one batch after another so the top cards fill in first.
    const pending: { fkey: string; date: string; spot: Spot }[] = [];
    for (const t of targets.values()) {
      const fkey = `${t.spot.lat.toFixed(2)},${t.spot.lng.toFixed(2)}|${t.date}`;
      if (!requested.current.has(fkey) && !pending.some((p) => p.fkey === fkey)) pending.push({ fkey, date: t.date, spot: t.spot });
    }
    let cancelled = false;
    void (async () => {
      for (let i = 0; i < pending.length && !cancelled; i += SUGGESTION_WEATHER_GROUP) {
        const group = pending.slice(i, i + SUGGESTION_WEATHER_GROUP);
        for (const date of new Set(group.map((g) => g.date))) {
          const part = group.filter((g) => g.date === date);
          for (const g of part) requested.current.add(g.fkey);
          const list = await loadForecastBatch(part.map((g) => g.spot), date);
          if (cancelled) {
            for (const g of part) requested.current.delete(g.fkey); // not shown: ask again next time
            return;
          }
          // A failed answer is not final: forget it so the next change to the list asks again.
          part.forEach((g, j) => {
            const f = list[j];
            if (!f || (!f.available && f.reason === "unavailable")) requested.current.delete(g.fkey);
          });
          setForecasts((prev) => {
            const next = new Map(prev);
            part.forEach((g, j) => next.set(g.fkey, list[j] ?? null));
            return next;
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targets, enabled]);
  return useMemo(() => {
    const lines = new Map<string, WeatherLine>();
    for (const [id, t] of targets) {
      const forecast = forecasts.get(`${t.spot.lat.toFixed(2)},${t.spot.lng.toFixed(2)}|${t.date}`);
      const line = forecast ? weatherLine(forecast, "golden", t.at, unit) : null;
      if (line && forecast?.available) lines.set(id, line);
    }
    return lines;
  }, [targets, forecasts, unit]);
}
