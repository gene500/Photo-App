import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/server/external/mapbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/external/mapbox")>()),
  getDirections: vi.fn(),
  geocode: vi.fn(),
}));
import { getCurrentUserId } from "@/server/session";
import { ExternalServiceError, geocode, getDirections } from "@/server/external/mapbox";
import { POST as directionsPOST } from "@/app/api/directions/route";
import { GET as geocodeGET } from "@/app/api/geocode/route";
import { jsonRequest } from "../helpers/requests";

describe("POST /api/directions", () => {
  beforeEach(() => vi.mocked(getCurrentUserId).mockResolvedValue("u1"));

  it("returns the route", async () => {
    vi.mocked(getDirections).mockResolvedValue({ geometry: [[0, 0], [1, 1]], legs: [{ distance: 1, duration: 1 }], distance: 1, duration: 1 });
    const res = await directionsPOST(jsonRequest("POST", "/api/directions", { coordinates: [[0, 0], [1, 1]] }));
    expect((await res.json()).route.legs).toHaveLength(1);
  });

  it("rejects more than 25 waypoints", async () => {
    const coordinates = Array.from({ length: 26 }, (_, i) => [i * 0.01, 0]);
    const res = await directionsPOST(jsonRequest("POST", "/api/directions", { coordinates }));
    expect(res.status).toBe(400);
  });

  it("returns 502 with Mapbox's user-safe message", async () => {
    vi.mocked(getDirections).mockRejectedValue(new ExternalServiceError("No driving route found between these points"));
    const res = await directionsPOST(jsonRequest("POST", "/api/directions", { coordinates: [[0, 0], [1, 1]] }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "No driving route found between these points" });
  });
});

describe("GET /api/geocode", () => {
  beforeEach(() => vi.mocked(getCurrentUserId).mockResolvedValue("u1"));

  it("returns places for a query", async () => {
    vi.mocked(geocode).mockResolvedValue([{ name: "Fresno", lat: 36.7, lng: -119.8 }]);
    const res = await geocodeGET(new Request("http://localhost/api/geocode?q=Fresno"));
    expect(await res.json()).toEqual({ places: [{ name: "Fresno", lat: 36.7, lng: -119.8 }] });
    expect(geocode).toHaveBeenCalledWith("Fresno", { proximity: undefined });
  });

  it("passes a proximity bias through", async () => {
    vi.mocked(geocode).mockResolvedValue([]);
    await geocodeGET(new Request("http://localhost/api/geocode?q=Spring&proximity=-119.79,36.74"));
    expect(geocode).toHaveBeenLastCalledWith("Spring", { proximity: { lng: -119.79, lat: 36.74 } });
  });

  it("rejects a malformed proximity", async () => {
    const res = await geocodeGET(new Request("http://localhost/api/geocode?q=Spring&proximity=nope"));
    expect(res.status).toBe(400);
  });

  it("rejects too-short queries", async () => {
    const res = await geocodeGET(new Request("http://localhost/api/geocode?q=a"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Type at least 2 characters" });
  });

  it("requires sign-in", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(null);
    expect((await geocodeGET(new Request("http://localhost/api/geocode?q=Fresno"))).status).toBe(401);
  });
});
