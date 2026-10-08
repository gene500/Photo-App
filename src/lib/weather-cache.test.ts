import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WeatherForecast } from "./types";

const weather = vi.fn();
vi.mock("./api-client", () => ({ api: { weather: (...a: unknown[]) => weather(...a) } }));
import { forecastKey, loadForecast, resetWeatherCache, WEATHER_FAILURE_TTL_MS, WEATHER_SUCCESS_TTL_MS } from "./weather-cache";

const ok: WeatherForecast = { available: true, utcOffsetSeconds: 0, hours: [{ time: "2026-07-01T10:00", cloudPct: 1, rainPct: 2, tempC: 3 }] };

describe("loadForecast", () => {
  beforeEach(() => {
    weather.mockReset();
    resetWeatherCache();
    vi.useRealTimers();
  });

  it("fetches once per rounded place and day, sharing the in-flight request", async () => {
    weather.mockResolvedValue({ forecast: ok });
    const [a, b] = await Promise.all([loadForecast(37.7712, -119.5, "2026-07-01"), loadForecast(37.7749, -119.5, "2026-07-01")]);
    expect(a).toEqual(ok);
    expect(b).toEqual(ok);
    await loadForecast(37.77, -119.5, "2026-07-01");
    expect(weather).toHaveBeenCalledTimes(1);
    await loadForecast(37.77, -119.5, "2026-07-02");
    expect(weather).toHaveBeenCalledTimes(2);
    expect(forecastKey(37.7749, -119.5, "d")).toBe("37.77,-119.50|d");
  });

  it("resolves null on failure, then retries after the failure window", async () => {
    vi.useFakeTimers();
    weather.mockRejectedValueOnce(new Error("offline"));
    expect(await loadForecast(1, 2, "2026-07-01")).toBeNull();
    expect(await loadForecast(1, 2, "2026-07-01")).toBeNull();
    expect(weather).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(WEATHER_FAILURE_TTL_MS + 1);
    weather.mockResolvedValue({ forecast: ok });
    expect(await loadForecast(1, 2, "2026-07-01")).toEqual(ok);
  });

  it("refetches a forecast after 30 minutes", async () => {
    vi.useFakeTimers();
    weather.mockResolvedValue({ forecast: ok });
    await loadForecast(1, 2, "2026-07-01");
    vi.advanceTimersByTime(WEATHER_SUCCESS_TTL_MS - 1);
    await loadForecast(1, 2, "2026-07-01");
    expect(weather).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2);
    await loadForecast(1, 2, "2026-07-01");
    expect(weather).toHaveBeenCalledTimes(2);
  });

  it("keeps an out-of-range answer for a while", async () => {
    weather.mockResolvedValue({ forecast: { available: false, reason: "out_of_range" } });
    await loadForecast(1, 2, "2030-01-01");
    await loadForecast(1, 2, "2030-01-01");
    expect(weather).toHaveBeenCalledTimes(1);
  });
});
