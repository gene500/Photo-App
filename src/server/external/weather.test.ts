import { afterEach, describe, expect, it, vi } from "vitest";
import { createForecastLookup, fetchForecast, getForecast, WEATHER_CACHE_MAX, WEATHER_FAILURE_TTL_MS, WEATHER_TTL_MS, weatherCacheKey } from "./weather";

const body = {
  utc_offset_seconds: -25200,
  hourly: { time: ["2026-07-01T19:00"], cloud_cover: [30], precipitation_probability: [15], temperature_2m: [17.2] },
};
const okFetch = () => vi.fn(async () => new Response(JSON.stringify(body)));

afterEach(() => {
  delete process.env.EXTERNAL_APIS_FAKE;
});

describe("fetchForecast", () => {
  it("calls the fixed Open-Meteo host with the day, auto timezone and a User-Agent", async () => {
    const f = okFetch();
    const r = await fetchForecast(37.7749, -122.4194, "2026-06-30", "2026-07-02", f);
    expect(r).toMatchObject({ available: true, utcOffsetSeconds: -25200 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      latitude: "37.77", longitude: "-122.42", hourly: "cloud_cover,precipitation_probability,temperature_2m",
      timezone: "auto", start_date: "2026-06-30", end_date: "2026-07-02",
    });
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/^RoadTripPhotoPlanner/);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("is unavailable on HTTP errors, network errors and bad JSON", async () => {
    const down = { available: false, reason: "unavailable" };
    expect(await fetchForecast(1, 2, "2026-07-01", "2026-07-01", vi.fn(async () => new Response("no", { status: 500 })))).toEqual(down);
    expect(await fetchForecast(1, 2, "2026-07-01", "2026-07-01", vi.fn().mockRejectedValue(new Error("x")))).toEqual(down);
    expect(await fetchForecast(1, 2, "2026-07-01", "2026-07-01", vi.fn(async () => new Response("<html>")))).toEqual(down);
  });
});

describe("forecast cache", () => {
  it("keys by 2-decimal place and date, and serves repeats from memory", async () => {
    const f = okFetch();
    const lookup = createForecastLookup({ fetchImpl: f });
    await lookup(37.7712, -122.4, "2026-07-01", "2026-06-30");
    await lookup(37.7749, -122.4, "2026-07-01", "2026-06-30");
    expect(f).toHaveBeenCalledTimes(1);
    await lookup(37.7749, -122.4, "2026-07-02");
    expect(f).toHaveBeenCalledTimes(2);
    expect(weatherCacheKey(37.7749, -122.4, "d")).toBe("37.77,-122.40|d");
  });

  it("shares one in-flight request between concurrent callers", async () => {
    const f = okFetch();
    const lookup = createForecastLookup({ fetchImpl: f });
    await Promise.all([lookup(1, 2, "2026-07-01"), lookup(1, 2, "2026-07-01")]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("requests the day before through the day after, clamped to the horizon", async () => {
    const f = okFetch();
    const lookup = createForecastLookup({ fetchImpl: f });
    await lookup(1, 2, "2026-07-10", "2026-07-05");
    const q = new URL((f.mock.calls[0] as unknown as [string])[0]).searchParams;
    expect([q.get("start_date"), q.get("end_date")]).toEqual(["2026-07-09", "2026-07-11"]);
    await lookup(1, 2, "2026-07-20", "2026-07-05");
    const q2 = new URL((f.mock.calls[1] as unknown as [string])[0]).searchParams;
    expect([q2.get("start_date"), q2.get("end_date")]).toEqual(["2026-07-19", "2026-07-20"]);
  });

  it("expires after 30 minutes; an unavailable answer is remembered for 60 s only", async () => {
    let t = 0;
    const f = okFetch();
    const lookup = createForecastLookup({ fetchImpl: f, now: () => t });
    await lookup(1, 2, "2026-07-01", "2026-07-01");
    t = WEATHER_TTL_MS - 1;
    await lookup(1, 2, "2026-07-01", "2026-07-01");
    expect(f).toHaveBeenCalledTimes(1);
    t = WEATHER_TTL_MS + 1;
    await lookup(1, 2, "2026-07-01", "2026-07-01");
    expect(f).toHaveBeenCalledTimes(2);

    t = 0;
    const bad = vi.fn(async () => new Response("no", { status: 503 }));
    const l2 = createForecastLookup({ fetchImpl: bad, now: () => t });
    await l2(1, 2, "2026-07-01", "2026-07-01");
    t = WEATHER_FAILURE_TTL_MS - 1;
    await l2(1, 2, "2026-07-01", "2026-07-01");
    expect(bad).toHaveBeenCalledTimes(1);
    t = WEATHER_FAILURE_TTL_MS + 1;
    await l2(1, 2, "2026-07-01", "2026-07-01");
    expect(bad).toHaveBeenCalledTimes(2);
  });

  it("is bounded, evicting the least recently used", async () => {
    const lookup = createForecastLookup({ fetchImpl: okFetch() });
    for (let i = 0; i < WEATHER_CACHE_MAX + 5; i++) await lookup(i % 80, Math.floor(i / 80), "2026-07-01", "2026-07-01");
    expect(lookup.size()).toBe(WEATHER_CACHE_MAX);
  });
});

describe("getForecast", () => {
  it("short-circuits dates outside today..today+15 without any request", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    try {
      expect(await getForecast(1, 2, "2026-10-23", "2026-10-07")).toEqual({ available: false, reason: "out_of_range" });
      expect(await getForecast(1, 2, "2026-10-05", "2026-10-07")).toEqual({ available: false, reason: "out_of_range" });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("returns deterministic offline data in fake mode, with a longitude-based offset", async () => {
    process.env.EXTERNAL_APIS_FAKE = "1";
    const a = await getForecast(37, -120, "2026-10-08", "2026-10-07");
    expect(a).toEqual(await getForecast(37, -120, "2026-10-08", "2026-10-07"));
    expect(a).toMatchObject({ available: true, utcOffsetSeconds: -8 * 3600 });
    if (a.available) expect(a.hours).toHaveLength(72); // 3 days
    expect(await getForecast(1, 2, "2026-10-06", "2026-10-07")).toMatchObject({ available: true }); // yesterday is allowed
  });
});
