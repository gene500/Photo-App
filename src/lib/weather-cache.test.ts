import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WeatherForecast } from "./types";

const weather = vi.fn();
const weatherBatch = vi.fn();
vi.mock("./api-client", () => ({ api: { weather: (...a: unknown[]) => weather(...a), weatherBatch: (...a: unknown[]) => weatherBatch(...a) } }));
import { cacheSize, forecastKey, HOLD_MAX_MS, holdWeather, loadForecast, loadForecastBatch, resetWeatherCache, WEATHER_FAILURE_TTL_MS, WEATHER_SUCCESS_TTL_MS } from "./weather-cache";

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

  it("evicts expired entries when the cache is next used", async () => {
    vi.useFakeTimers();
    weather.mockResolvedValue({ forecast: ok });
    await loadForecast(1, 2, "2026-07-01");
    expect(cacheSize()).toBe(1);
    vi.advanceTimersByTime(WEATHER_SUCCESS_TTL_MS + 1);
    await loadForecast(5, 6, "2026-07-01");
    expect(cacheSize()).toBe(1); // the old (1,2) entry is gone, only the new one remains
  });
});

describe("weather priority hold", () => {
  beforeEach(() => {
    weather.mockReset();
    resetWeatherCache();
    vi.useRealTimers();
  });

  it("makes weather requests wait until every hold is released", async () => {
    weather.mockResolvedValue({ forecast: ok });
    const a = holdWeather();
    const b = holdWeather();
    const p = loadForecast(1, 2, "2026-07-01");
    await new Promise((r) => setTimeout(r, 20));
    expect(weather).not.toHaveBeenCalled();
    a();
    await new Promise((r) => setTimeout(r, 20));
    expect(weather).not.toHaveBeenCalled();
    b();
    expect(await p).toEqual(ok);
    expect(weather).toHaveBeenCalledTimes(1);
  });

  it("lets go of a forgotten hold after HOLD_MAX_MS", async () => {
    vi.useFakeTimers();
    weather.mockResolvedValue({ forecast: ok });
    holdWeather();
    const p = loadForecast(1, 2, "2026-07-01");
    await vi.advanceTimersByTimeAsync(HOLD_MAX_MS + 1);
    expect(await p).toEqual(ok);
  });

  it("batches places 10 to a request, after the hold", async () => {
    const batch = vi.fn(async (_d: string, pts: unknown[]) => ({ forecasts: pts.map(() => ok) }));
    weatherBatch.mockImplementation(batch);
    const release = holdWeather();
    const pts = Array.from({ length: 12 }, (_, i) => ({ lat: i, lng: 0 }));
    const p = loadForecastBatch(pts, "2026-07-01");
    await new Promise((r) => setTimeout(r, 10));
    expect(batch).not.toHaveBeenCalled();
    release();
    const out = await p;
    expect(batch).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(12);
    expect(out.every((f) => f === ok)).toBe(true);
  });
});
