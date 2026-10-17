import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMapboxCaches, ExternalServiceError, geocode, getDirections, getDurationMatrix, reverseGeocode } from "./mapbox";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const okRoute = {
  code: "Ok",
  routes: [{
    geometry: { type: "LineString", coordinates: [[-119.79, 36.74], [-119.6, 37.2], [-119.12, 37.96]] },
    legs: [{ distance: 50_000, duration: 3_600, steps: [] }, { distance: 90_000, duration: 5_400, steps: [] }],
    distance: 140_000,
    duration: 9_000,
  }],
};

describe("mapbox", () => {
  beforeEach(() => {
    process.env.MAPBOX_TOKEN = "test-token";
    delete process.env.EXTERNAL_APIS_FAKE;
    clearMapboxCaches();
  });
  afterEach(() => {
    delete process.env.MAPBOX_TOKEN;
  });

  it("serves a repeat request for the same stops from memory, but never caches a failure", async () => {
    const stops: [number, number][] = [[-1, -1], [-2, -2]];
    const failing = vi.fn(async () => json({ code: "NoRoute" }, 200));
    await expect(getDirections(stops, failing)).rejects.toThrow();
    const fetchImpl = vi.fn(async () => json(okRoute));
    const first = await getDirections(stops, fetchImpl);
    expect(await getDirections(stops, fetchImpl)).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("requests a driving route with GeoJSON geometry", async () => {
    const fetchImpl = vi.fn(async () => json(okRoute));
    await getDirections([[-119.79, 36.74], [-119.6, 37.2], [-119.12, 37.96]], fetchImpl);
    const url = new URL((fetchImpl.mock.calls[0] as unknown as [string])[0]);
    expect(url.pathname).toBe("/directions/v5/mapbox/driving/-119.790000,36.740000;-119.600000,37.200000;-119.120000,37.960000");
    expect(url.searchParams.get("geometries")).toBe("geojson");
    expect(url.searchParams.get("overview")).toBe("full");
    expect(url.searchParams.get("access_token")).toBe("test-token");
  });

  it("maps the first route to a RouteResult", async () => {
    const route = await getDirections([[0, 0], [1, 1], [2, 2]], vi.fn(async () => json(okRoute)));
    expect(route).toEqual({
      geometry: okRoute.routes[0].geometry.coordinates,
      legs: [{ distance: 50_000, duration: 3_600 }, { distance: 90_000, duration: 5_400 }],
      distance: 140_000,
      duration: 9_000,
    });
  });

  it("explains NoRoute", async () => {
    const fetchImpl = vi.fn(async () => json({ code: "NoRoute", message: "No route found" }));
    await expect(getDirections([[0, 0], [1, 1]], fetchImpl)).rejects.toThrow("No driving route found between these points");
  });

  it("wraps network failures", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(getDirections([[0, 0], [1, 1]], fetchImpl)).rejects.toThrow("Couldn't reach the routing service");
  });

  it("fails clearly without a token", async () => {
    delete process.env.MAPBOX_TOKEN;
    await expect(getDirections([[0, 0], [1, 1]], vi.fn())).rejects.toBeInstanceOf(ExternalServiceError);
  });

  it("falls back to the name, then coordinates, when full_address is empty", async () => {
    const named = vi.fn(async () => json({ features: [{ geometry: { coordinates: [0, 0] }, properties: { name: "Tunnel View", full_address: "" } }] }));
    expect((await reverseGeocode({ lat: 37.5, lng: -119.5 }, named)).name).toBe("Tunnel View");
    clearMapboxCaches();
    const bare = vi.fn(async () => json({ features: [{ geometry: { coordinates: [0, 0] }, properties: { full_address: "" } }] }));
    expect((await reverseGeocode({ lat: 37.5, lng: -119.5 }, bare)).name).toBe("37.5000, -119.5000");
  });

  it("truncates very long place names to 200 characters", async () => {
    const long = "x".repeat(500);
    const fetchImpl = vi.fn(async () => json({ features: [{ geometry: { coordinates: [1, 2] }, properties: { full_address: long } }] }));
    expect((await geocode("x", {}, fetchImpl))[0].name).toHaveLength(200);
    expect((await reverseGeocode({ lat: 1, lng: 2 }, fetchImpl)).name).toHaveLength(200);
  });

  it("geocodes a query into places", async () => {
    const fetchImpl = vi.fn(async () => json({
      features: [{ geometry: { coordinates: [-119.79, 36.74] }, properties: { name: "Fresno", full_address: "Fresno, California, United States" } }],
    }));
    expect(await geocode("Fresno, CA", {}, fetchImpl)).toEqual([{ name: "Fresno, California, United States", lat: 36.74, lng: -119.79 }]);
    const url = new URL((fetchImpl.mock.calls[0] as unknown as [string])[0]);
    expect(url.pathname).toBe("/search/geocode/v6/forward");
    expect(url.searchParams.get("q")).toBe("Fresno, CA");
  });

  it("uses fake data in fake mode", async () => {
    process.env.EXTERNAL_APIS_FAKE = "1";
    const fetchImpl = vi.fn();
    expect((await getDirections([[0, 0], [0, 1]], fetchImpl)).legs).toHaveLength(1);
    expect((await geocode("Alpha", {}, fetchImpl))[0].name).toBe("Alpha (fake)");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("asks for autocomplete results biased to a proximity", async () => {
    const fetchImpl = vi.fn(async () => json({ features: [] }));
    await geocode("Spring", { proximity: { lat: 36.74, lng: -119.79 } }, fetchImpl);
    const url = new URL((fetchImpl.mock.calls[0] as unknown as [string])[0]);
    expect(url.searchParams.get("autocomplete")).toBe("true");
    expect(url.searchParams.get("proximity")).toBe("-119.790000,36.740000");
  });

  it("reverse geocodes a click, keeping the clicked coordinates", async () => {
    const fetchImpl = vi.fn(async () => json({
      features: [{ geometry: { coordinates: [-119.5, 37.5] }, properties: { name: "Tunnel View", full_address: "Tunnel View, Yosemite, California" } }],
    }));
    expect(await reverseGeocode({ lat: 37.5001, lng: -119.5001 }, fetchImpl)).toEqual({
      name: "Tunnel View, Yosemite, California", lat: 37.5001, lng: -119.5001,
    });
    const url = new URL((fetchImpl.mock.calls[0] as unknown as [string])[0]);
    expect(url.pathname).toBe("/search/geocode/v6/reverse");
    expect(url.searchParams.get("longitude")).toBe("-119.500100");
    expect(url.searchParams.get("latitude")).toBe("37.500100");
  });

  it("falls back to coordinates when nothing is found at a spot", async () => {
    const fetchImpl = vi.fn(async () => json({ features: [] }));
    expect((await reverseGeocode({ lat: 37.5, lng: -119.5 }, fetchImpl)).name).toBe("37.5000, -119.5000");
  });

  it("reverse geocodes with fake data in fake mode", async () => {
    process.env.EXTERNAL_APIS_FAKE = "1";
    const fetchImpl = vi.fn();
    expect(await reverseGeocode({ lat: 37, lng: -119 }, fetchImpl)).toEqual({ name: "Spot 37.0000, -119.0000 (fake)", lat: 37, lng: -119 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  describe("getDurationMatrix", () => {
    const three: [number, number][] = [[-119.79, 36.74], [-119.6, 37.2], [-119.12, 37.96]];
    const okMatrix = { code: "Ok", durations: [[0, 10, 30], [12, 0, 20], [31, 21, 0]] };

    it("requests the Matrix API with duration annotations", async () => {
      const fetchImpl = vi.fn(async () => json(okMatrix));
      expect(await getDurationMatrix(three, fetchImpl)).toEqual(okMatrix.durations);
      const url = new URL((fetchImpl.mock.calls[0] as unknown as [string])[0]);
      expect(url.pathname).toBe("/directions-matrix/v1/mapbox/driving/-119.790000,36.740000;-119.600000,37.200000;-119.120000,37.960000");
      expect(url.searchParams.get("annotations")).toBe("duration");
      expect(url.searchParams.get("access_token")).toBe("test-token");
    });

    it("maps null (unreachable) durations to Infinity", async () => {
      const body = { code: "Ok", durations: [[0, null, 30], [12, 0, 20], [31, 21, 0]] };
      expect((await getDurationMatrix(three, vi.fn(async () => json(body))))[0][1]).toBe(Infinity);
    });

    it("rejects a malformed matrix", async () => {
      const bad = vi.fn(async () => json({ code: "Ok", durations: [[0, 1], [1, 0]] }));
      await expect(getDurationMatrix(three, bad)).rejects.toBeInstanceOf(ExternalServiceError);
    });

    it("explains service errors and network failures", async () => {
      const failed = vi.fn(async () => json({ code: "InvalidInput" }, 422));
      await expect(getDurationMatrix(three, failed)).rejects.toThrow("Couldn't calculate drive times. Please try again.");
      const down = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
      await expect(getDurationMatrix(three, down)).rejects.toThrow("Couldn't reach the routing service");
    });

    it("refuses more than 25 coordinates and uses fake data in fake mode", async () => {
      const many = Array.from({ length: 26 }, (_, i) => [i * 0.01, 0] as [number, number]);
      await expect(getDurationMatrix(many, vi.fn())).rejects.toBeInstanceOf(ExternalServiceError);
      process.env.EXTERNAL_APIS_FAKE = "1";
      const fetchImpl = vi.fn();
      expect(await getDurationMatrix([[0, 0], [0, 1]], fetchImpl)).toHaveLength(2);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });
});

describe("mapbox caches and shape guards", () => {
  beforeEach(() => {
    process.env.MAPBOX_TOKEN = "t";
    delete process.env.EXTERNAL_APIS_FAKE;
    clearMapboxCaches();
  });
  const json = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body)));

  it("serves a repeated search from memory", async () => {
    const f = json({ features: [{ geometry: { coordinates: [1, 2] }, properties: { name: "A" } }] });
    await geocode("Yosemite", {}, f as unknown as typeof fetch);
    await geocode("yosemite", {}, f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("serves a repeated reverse lookup and matrix from memory", async () => {
    const r = json({ features: [{ geometry: { coordinates: [1, 2] }, properties: { name: "A" } }] });
    await reverseGeocode({ lat: 1, lng: 2 }, r as unknown as typeof fetch);
    await reverseGeocode({ lat: 1, lng: 2 }, r as unknown as typeof fetch);
    expect(r).toHaveBeenCalledTimes(1);
    const m = json({ code: "Ok", durations: [[0, 5], [5, 0]] });
    const pts: [number, number][] = [[1, 2], [3, 4]];
    await getDurationMatrix(pts, m as unknown as typeof fetch);
    await getDurationMatrix(pts, m as unknown as typeof fetch);
    expect(m).toHaveBeenCalledTimes(1);
  });
  it("skips malformed features and turns a malformed route into a service error", async () => {
    const f = json({ features: [null, { geometry: {}, properties: {} }, { geometry: { coordinates: [1, 2] }, properties: { name: "ok" } }] });
    expect(await geocode("x y", {}, f as unknown as typeof fetch)).toHaveLength(1);
    const d = json({ code: "Ok", routes: [{ geometry: null, legs: null, distance: 1, duration: 1 }] });
    await expect(getDirections([[1, 2], [3, 4]], d as unknown as typeof fetch)).rejects.toBeInstanceOf(ExternalServiceError);
  });
});

describe("mapbox malformed upstream data", () => {
  beforeEach(() => {
    process.env.MAPBOX_TOKEN = "test-token";
    delete process.env.EXTERNAL_APIS_FAKE;
    clearMapboxCaches();
  });
  afterEach(() => {
    delete process.env.MAPBOX_TOKEN;
  });
  const stops: [number, number][] = [[-1, -1], [-2, -2]];
  const withLegs = (legs: unknown) => ({ code: "Ok", routes: [{ geometry: { coordinates: [[0, 0], [1, 1]] }, legs, distance: 1, duration: 1 }] });

  it("rejects directions with bad legs as an ExternalServiceError", async () => {
    for (const legs of [[null], [{}], [{ distance: "a", duration: 1 }]]) {
      await expect(getDirections(stops, async () => json(withLegs(legs)))).rejects.toThrow(ExternalServiceError);
    }
  });
  it("skips geocode features with a non-string name or out-of-range coordinates", async () => {
    const features = [
      { geometry: { coordinates: [999, -999] }, properties: { full_address: "Far" } },
      { geometry: { coordinates: [-100, 40] }, properties: { full_address: 5, name: 7 } },
      { geometry: { coordinates: [-101, 41] }, properties: { full_address: "Good" } },
    ];
    const out = await geocode("x", {}, async () => json({ features }));
    expect(out.map((p) => p.name)).toEqual(["x", "Good"]);
  });
  it("rejects a matrix with negative durations", async () => {
    await expect(getDurationMatrix(stops, async () => json({ code: "Ok", durations: [[0, -5], [3, 0]] }))).rejects.toThrow(ExternalServiceError);
  });
  it("does not name the missing token in the message sent to clients", async () => {
    delete process.env.MAPBOX_TOKEN;
    const err = await getDirections(stops, async () => json({})).catch((e) => e);
    expect(err).toBeInstanceOf(ExternalServiceError);
    expect(err.message).toBe("Service temporarily unavailable");
    expect(err.message).not.toMatch(/MAPBOX/);
  });
});
