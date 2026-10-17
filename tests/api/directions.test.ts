import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/server/external/mapbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/external/mapbox")>()),
  getDirections: vi.fn(),
}));
import { getCurrentUserId } from "@/server/session";
import { ExternalServiceError, getDirections } from "@/server/external/mapbox";
import { POST as directionsPOST } from "@/app/api/directions/route";
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
