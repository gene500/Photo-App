import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalServiceError, geocode, getDirections, reverseGeocode } from "./mapbox";

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
  });
  afterEach(() => {
    delete process.env.MAPBOX_TOKEN;
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
});
