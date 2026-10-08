// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WeatherForecast } from "./types";

const loadForecast = vi.fn();
vi.mock("./weather-cache", () => ({ loadForecast: (...a: unknown[]) => loadForecast(...a) }));
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
    expect(weatherLine(forecastFor("2026-07-01"), "sunset", at)).toEqual({ text: "clear, 15% rain", quality: "good" });
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
    const { result } = renderHook(() => useWeatherLine(0, 0, at, "sunset"));
    await waitFor(() => expect(result.current).toEqual({ text: "clear, 15% rain", quality: "good" }));
    expect(loadForecast).toHaveBeenCalledWith(0, 0, date);
  });

  it("stays silent when the fetch fails", async () => {
    const at = day(1);
    loadForecast.mockResolvedValue(null);
    const { result } = renderHook(() => useWeatherLine(0, 0, at, "sunset"));
    await waitFor(() => expect(loadForecast).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it("answers 'not available yet' beyond the horizon without a request, and nothing for the past", () => {
    const far = renderHook(() => useWeatherLine(0, 0, day(40), "sunset"));
    expect(far.result.current?.text).toBe("Forecast not available yet");
    const past = renderHook(() => useWeatherLine(0, 0, day(-40), "sunset"));
    expect(past.result.current).toBeNull();
    expect(loadForecast).not.toHaveBeenCalled();
  });
});
