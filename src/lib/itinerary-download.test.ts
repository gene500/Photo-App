// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./weather-cache", () => ({ loadForecast: vi.fn(), loadForecastBatch: vi.fn() }));

import { loadMapImage, loadWeatherLines } from "./itinerary-download";
import { loadForecast } from "./weather-cache";
import type { WeatherForecast } from "./types";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const imageResponse = (type = "image/png") => new Response(PNG, { status: 200, headers: { "content-type": type } });

describe("loadMapImage", () => {
  it("is the fallback without a URL and does not fetch", async () => {
    const fetchImpl = vi.fn();
    expect(await loadMapImage(null, { fetchImpl })).toEqual({ kind: "fallback" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("is the fallback for a non-OK response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("no", { status: 500 }));
    expect(await loadMapImage("https://x/y", { fetchImpl })).toEqual({ kind: "fallback" });
  });
  it("is the fallback when fetch rejects", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await loadMapImage("https://x/y", { fetchImpl })).toEqual({ kind: "fallback" });
  });
  it("is the fallback when fetch never resolves", async () => {
    const fetchImpl = vi.fn((_u: string, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener("abort", () => rej(new Error("aborted")));
    }));
    expect(await loadMapImage("https://x/y", { fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 20 })).toEqual({ kind: "fallback" });
  });
  it("is the fallback for a non-image content type", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse("text/html"));
    expect(await loadMapImage("https://x/y", { fetchImpl })).toEqual({ kind: "fallback" });
  });
  it("returns a data URL for an image", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(imageResponse());
    const map = await loadMapImage("https://x/y", { fetchImpl });
    expect(map.kind).toBe("image");
    if (map.kind === "image") expect(map.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });
});

describe("loadWeatherLines", () => {
  afterEach(() => vi.clearAllMocks());
  const day = new Date();
  day.setUTCHours(12, 0, 0, 0);
  const forecast: WeatherForecast = {
    available: true,
    utcOffsetSeconds: 0,
    hours: [{ time: day.toISOString().slice(0, 13) + ":00", cloudPct: 10, rainPct: 0, tempC: 15 }],
  };

  it("gives a line per stop, null without arrival, null for a failing stop", async () => {
    vi.mocked(loadForecast).mockImplementation(async (lat) => {
      if (lat === 3) throw new Error("boom");
      return forecast;
    });
    const stop = (lat: number, arrival: Date | null) => ({ lat, lng: 0, lightPref: "any" as const, arrival });
    const lines = await loadWeatherLines({ stops: [stop(1, day), stop(2, null), stop(3, day), stop(4, day)], unit: "km" });
    expect(lines).toHaveLength(4);
    expect(lines[0]).not.toBeNull();
    expect(lines[1]).toBeNull();
    expect(lines[2]).toBeNull();
    expect(lines[3]).not.toBeNull();
    expect(loadForecast).not.toHaveBeenCalledWith(2, expect.anything(), expect.anything());
  });
  it("is null outside the forecast range without a request", async () => {
    const far = new Date(Date.now() + 900 * 86400000);
    const lines = await loadWeatherLines({ stops: [{ lat: 1, lng: 0, lightPref: "any", arrival: far }], unit: "km" });
    expect(lines[0]).toEqual({ text: "Forecast not available yet", quality: null });
    const past = new Date(Date.now() - 30 * 86400000);
    expect(await loadWeatherLines({ stops: [{ lat: 1, lng: 0, lightPref: "any", arrival: past }], unit: "km" })).toEqual([null]);
    expect(loadForecast).not.toHaveBeenCalled();
  });
});
