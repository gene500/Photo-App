// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./weather-cache", () => ({ loadForecast: vi.fn(), loadForecastBatch: vi.fn() }));

import { readFileSync } from "node:fs";
import { createItineraryPdf, loadMapImage, loadWeatherLines, mapTokenFromEnv, saveBlob } from "./itinerary-download";
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
  it("is the fallback for image types other than PNG or JPEG", async () => {
    for (const type of ["image/svg+xml", "image/gif", "image/webp"]) {
      const fetchImpl = vi.fn().mockResolvedValue(imageResponse(type));
      expect(await loadMapImage("https://x/y", { fetchImpl })).toEqual({ kind: "fallback" });
    }
  });
  it("is the fallback when the bytes are not the declared PNG/JPEG", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("<svg/>", { status: 200, headers: { "content-type": "image/png" } }));
    expect(await loadMapImage("https://x/y", { fetchImpl })).toEqual({ kind: "fallback" });
    const jpegAsPng = vi.fn().mockResolvedValue(new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { status: 200, headers: { "content-type": "image/png" } }));
    expect(await loadMapImage("https://x/y", { fetchImpl: jpegAsPng })).toEqual({ kind: "fallback" });
  });
  it("accepts a JPEG", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { status: 200, headers: { "content-type": "image/jpeg" } }));
    expect((await loadMapImage("https://x/y", { fetchImpl })).kind).toBe("image");
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
  it("resolves every stop to null when the weather step exceeds the timeout", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(loadForecast).mockImplementation(() => new Promise<WeatherForecast>(() => {}));
      const stop = (lat: number) => ({ lat, lng: 0, lightPref: "any" as const, arrival: day });
      const p = loadWeatherLines({ stops: [stop(1), stop(2)], unit: "km" });
      await vi.advanceTimersByTimeAsync(6000);
      expect(await p).toEqual([null, null]);
    } finally {
      vi.useRealTimers();
    }
  });
  it("returns fast forecasts without waiting for the timeout", async () => {
    vi.mocked(loadForecast).mockResolvedValue(forecast);
    const lines = await loadWeatherLines({ stops: [{ lat: 1, lng: 0, lightPref: "any", arrival: day }], unit: "km", timeoutMs: 50 });
    expect(lines[0]).not.toBeNull();
  });
});

describe("saveBlob", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("clicks a temporary download link with the file name, removes it, and frees the URL a moment later", () => {
    vi.useFakeTimers();
    URL.createObjectURL = vi.fn(() => "blob:fake");
    URL.revokeObjectURL = vi.fn();
    const seen: { download: string; href: string; attached: boolean }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      seen.push({ download: this.download, href: this.href, attached: document.body.contains(this) });
    });
    const blob = new Blob(["x"]);
    saveBlob(blob, "trip-itinerary.pdf");
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(seen).toEqual([{ download: "trip-itinerary.pdf", href: "blob:fake", attached: true }]);
    expect(document.querySelector("a[download]")).toBeNull();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
  });
});

describe("mapTokenFromEnv", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is the public Mapbox token, or null when unset or empty", () => {
    vi.stubEnv("NEXT_PUBLIC_MAP_FAKE", "");
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "pk.test-token");
    expect(mapTokenFromEnv()).toBe("pk.test-token");
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "");
    expect(mapTokenFromEnv()).toBeNull();
  });

  it("is null in fake-map mode even when a token is set", () => {
    vi.stubEnv("NEXT_PUBLIC_MAP_FAKE", "1");
    vi.stubEnv("NEXT_PUBLIC_MAPBOX_TOKEN", "pk.test-token");
    expect(mapTokenFromEnv()).toBeNull();
  });
});

describe("createItineraryPdf", () => {
  const ONE_PX_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const input = { tripName: "Coastal Tripname", dateLine: "Planned for 2026-10-16", startLine: null, routeLine: null, note: null, stops: [{ index: 1, name: "Stopname1", arrival: "9:00 AM", bestLight: null, weather: null, notes: null }] };
  const stops = [{ lat: 37.7, lng: -122.4 }, { lat: 37.8, lng: -122.2 }];
  const geometry: [number, number][] = [[-122.4, 37.7], [-122.2, 37.8]];
  const font = (name: string) => readFileSync(`public/fonts/${name}`);
  const text = async (b: Blob) => Buffer.from(await b.arrayBuffer()).toString("latin1");
  const fetchStub = (mapOk: boolean, fontsOk = true) =>
    vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (fontsOk && u.includes("NotoSans-Bold")) return new Response(font("NotoSans-Bold.ttf"));
      if (fontsOk && u.includes("NotoSans")) return new Response(font("NotoSans-Regular.ttf"));
      if (mapOk && u.includes("api.mapbox.com")) return new Response(Buffer.from(ONE_PX_PNG, "base64"), { headers: { "content-type": "image/png" } });
      return new Response("no", { status: 404 });
    });
  afterEach(() => vi.unstubAllGlobals());

  it("fetches the Mapbox image with the token and the Unicode fonts, and embeds both in the PDF", async () => {
    const fetchMock = fetchStub(true);
    vi.stubGlobal("fetch", fetchMock);
    const s = await text(await createItineraryPdf({ input, geometry, stops, token: "pk.test-token" }));
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("api.mapbox.com") && u.includes("access_token=pk.test-token"))).toBe(true);
    expect(s.startsWith("%PDF")).toBe(true);
    expect(s).toContain("/Subtype /Image");
    expect(s).toContain("/BaseFont /NotoSans");
  });

  it("without a token asks Mapbox for nothing and draws the map itself", async () => {
    const fetchMock = fetchStub(true);
    vi.stubGlobal("fetch", fetchMock);
    const s = await text(await createItineraryPdf({ input, geometry, stops, token: null }));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("mapbox"))).toBe(false);
    expect(s).not.toContain("/Subtype /Image");
  });

  it("still makes the PDF with built-in fonts and the drawn map when every download fails", async () => {
    vi.stubGlobal("fetch", fetchStub(false, false));
    const s = await text(await createItineraryPdf({ input, geometry, stops, token: "pk.test-token" }));
    expect(s.startsWith("%PDF")).toBe(true);
    expect(s).not.toContain("/Subtype /Image");
    expect(s).not.toContain("/BaseFont /NotoSans");
    expect(s).toContain("/BaseFont /Helvetica");
  });
});
