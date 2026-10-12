// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WeatherForecast } from "./types";

const loadForecast = vi.fn();
vi.mock("./weather-cache", () => ({ loadForecast: (...a: unknown[]) => loadForecast(...a), loadForecastBatch: vi.fn() }));
import { forecastInstant } from "./light-windows";
import { useWeatherLine, weatherLine } from "./use-weather";

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000);
const dateOf = (d: Date) => d.toISOString().slice(0, 10);
const forecastFor = (date: string): WeatherForecast => ({
  available: true,
  utcOffsetSeconds: 0,
  hours: [{ time: `${date}T12:00`, cloudPct: 10, rainPct: 15, tempC: 20 }],
});

describe("weatherLine", () => {
  it("describes the hour and rates the light", () => {
    const at = new Date("2026-07-01T12:10:00Z");
    expect(weatherLine(forecastFor("2026-07-01"), "sunset", at)).toEqual({ text: "☀️ 20°C", label: "clear, 15% rain", quality: "good" });
  });
  it("shows Fahrenheit for miles", () => {
    expect(weatherLine(forecastFor("2026-07-01"), "any", new Date("2026-07-01T12:10:00Z"), "mi")?.text).toBe("☀️ 68°F");
  });
  it("marks typical weather as typical, not a forecast", () => {
    const typical = { ...forecastFor("2027-07-01"), typical: true as const };
    const line = weatherLine(typical, "any", new Date("2027-07-01T12:10:00Z"));
    expect(line?.text).toBe("Typical ☀️ 20°C");
    expect(line?.label).toMatch(/^Typically clear, rain on ~15% of days$/);
  });
  it("says nothing when the lookup failed, is unavailable or has no hour near the instant", () => {
    const at = new Date("2026-07-01T12:10:00Z");
    expect(weatherLine(null, "sunset", at)).toBeNull();
    expect(weatherLine({ available: false, reason: "unavailable" }, "sunset", at)).toBeNull();
    expect(weatherLine(forecastFor("2026-07-01"), "sunset", new Date("2026-07-01T20:00:00Z"))).toBeNull();
  });
  it("says 'Forecast not available yet' when out of range", () => {
    expect(weatherLine({ available: false, reason: "out_of_range" }, "golden", new Date())?.text).toBe("Forecast not available yet");
  });
});

describe("useWeatherLine", () => {
  beforeEach(() => loadForecast.mockReset());

  it("does nothing without an arrival", () => {
    const { result } = renderHook(() => useWeatherLine(0, 0, null, "sunset"));
    expect(result.current).toBeNull();
    expect(loadForecast).not.toHaveBeenCalled();
  });

  it("loads the forecast for the arrival's day and returns the line", async () => {
    const at = day(2);
    at.setUTCHours(12, 0, 0, 0);
    const date = dateOf(at);
    loadForecast.mockResolvedValue(forecastFor(date));
    const { result } = renderHook(() => useWeatherLine(0, 0, at, "any"));
    await waitFor(() => expect(result.current).toEqual({ text: "☀️ 68°F", label: "clear, 15% rain", quality: null }));
    expect(loadForecast).toHaveBeenCalledWith(0, 0, date);
  });

  it("reads a sunset stop's weather at the middle of its window, not at the 2 pm arrival", async () => {
    const arrival = day(3);
    arrival.setUTCHours(14, 0, 0, 0);
    const mid = forecastInstant("sunset", 0, 0, arrival);
    expect(mid.getTime() - arrival.getTime()).toBeGreaterThan(2 * 3600_000);
    const hour = (d: Date, cloudPct: number) => ({ time: `${d.toISOString().slice(0, 13)}:00`, cloudPct, rainPct: 5, tempC: 20 });
    const midHour = new Date(Math.round(mid.getTime() / 3600_000) * 3600_000);
    loadForecast.mockResolvedValue({ available: true, utcOffsetSeconds: 0, hours: [hour(arrival, 3), hour(midHour, 95)] });
    const { result } = renderHook(() => useWeatherLine(0, 0, arrival, "sunset"));
    await waitFor(() => expect(result.current).toEqual({ text: "☁️ 68°F", label: "overcast, 5% rain", quality: "poor" }));
    expect(loadForecast).toHaveBeenCalledWith(0, 0, dateOf(mid));
  });

  it("stays silent when the fetch fails", async () => {
    const at = day(1);
    loadForecast.mockResolvedValue(null);
    const { result } = renderHook(() => useWeatherLine(0, 0, at, "sunset"));
    await waitFor(() => expect(loadForecast).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it("asks for typical weather past the forecast horizon", async () => {
    const at = day(60);
    at.setUTCHours(12, 0, 0, 0);
    loadForecast.mockResolvedValue({ ...forecastFor(dateOf(at)), typical: true });
    const { result } = renderHook(() => useWeatherLine(0, 0, at, "any"));
    await waitFor(() => expect(result.current?.text).toBe("Typical ☀️ 68°F"));
  });

  it("answers 'not available yet' beyond the typical range without a request, and nothing for the past", () => {
    const far = renderHook(() => useWeatherLine(0, 0, day(900), "any"));
    expect(far.result.current?.text).toBe("Forecast not available yet");
    const past = renderHook(() => useWeatherLine(0, 0, day(-40), "any"));
    expect(past.result.current).toBeNull();
    expect(loadForecast).not.toHaveBeenCalled();
  });
});

describe("useSuggestionWeather", () => {
  it("waits for enabled, then asks five at a time from the top of the list", async () => {
    const { loadForecastBatch } = await import("./weather-cache");
    const batch = vi.mocked(loadForecastBatch);
    const calls: number[][] = [];
    batch.mockImplementation(async (pts) => {
      calls.push(pts.map((p) => p.lat));
      return pts.map(() => null);
    });
    const { useSuggestionWeather } = await import("./use-weather");
    const date = dateOf(day(2));
    const spots = Array.from({ length: 12 }, (_, i) => ({ osmId: `n/${i}`, lat: 30 + i * 0.5, lng: -100 }));
    const { rerender } = renderHook(({ on }) => useSuggestionWeather(spots, date, on), { initialProps: { on: false } });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(0);
    rerender({ on: true });
    await waitFor(() => expect(calls.length).toBe(3));
    expect(calls.map((c) => c.length)).toEqual([5, 5, 2]);
    expect(calls[0][0]).toBe(30);
    expect(calls[1][0]).toBe(32.5);
  });

  it("has at most two groups in flight and starts them strictly top-down", async () => {
    const { loadForecastBatch } = await import("./weather-cache");
    const batch = vi.mocked(loadForecastBatch);
    const started: number[] = [];
    const releases: Array<() => void> = [];
    batch.mockImplementation(
      (pts) =>
        new Promise((resolve) => {
          started.push(pts[0].lat);
          releases.push(() => resolve(pts.map(() => null)));
        }),
    );
    const { useSuggestionWeather } = await import("./use-weather");
    const date = dateOf(day(2));
    const spots = Array.from({ length: 15 }, (_, i) => ({ osmId: `p/${i}`, lat: 30 + i * 0.5, lng: -100 }));
    renderHook(() => useSuggestionWeather(spots, date, true));
    await waitFor(() => expect(started).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(started).toEqual([30, 32.5]); // third group waits for a free slot
    await act(async () => releases[1]());
    await waitFor(() => expect(started).toHaveLength(3));
    expect(started[2]).toBe(35);
  });
});
