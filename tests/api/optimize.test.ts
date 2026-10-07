import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/server/external/mapbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/external/mapbox")>()),
  getDurationMatrix: vi.fn(),
}));
import { getCurrentUserId } from "@/server/session";
import { ExternalServiceError, getDurationMatrix } from "@/server/external/mapbox";
import { POST } from "@/app/api/optimize/route";
import { fakeDurationMatrix } from "@/server/external/fake";
import { jsonRequest } from "../helpers/requests";

const post = (coordinates: unknown, extra: object = {}) => POST(jsonRequest("POST", "/api/optimize", { coordinates, ...extra }));

describe("POST /api/optimize", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUserId).mockResolvedValue("u1");
    vi.mocked(getDurationMatrix).mockImplementation(async (c) => fakeDurationMatrix(c));
  });
  afterEach(() => vi.mocked(getDurationMatrix).mockReset());

  it("requires sign-in", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(null);
    expect((await post([[0, 0], [0, 1], [0, 2]])).status).toBe(401);
  });

  it("needs at least 3 stops and at most 25", async () => {
    expect((await post([[0, 0], [0, 1]])).status).toBe(400);
    expect((await post(Array.from({ length: 26 }, (_, i) => [i * 0.01, 0]))).status).toBe(400);
    expect((await post([[0, 0], [0, 1], [200, 2]])).status).toBe(400);
  });

  it("returns indices that sort a shuffled line, keeping the start first", async () => {
    // lat 0, 3, 1, 2 along one meridian
    const res = await post([[0, 0], [0, 3], [0, 1], [0, 2]]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ order: [0, 2, 3, 1], departAt: null, misses: [] });
  });

  it("rejects a stops list whose length differs from the coordinates", async () => {
    const res = await post([[0, 0], [0, 1], [0, 2]], { stops: [{ lightPref: "any", dwellMinutes: 30 }] });
    expect(res.status).toBe(400);
    expect((await post([[0, 0], [0, 1], [0, 2]], { stops: [1, 2, 3].map(() => ({ lightPref: "dusk", dwellMinutes: 30 })) })).status).toBe(400);
    expect((await post([[0, 0], [0, 1], [0, 2]], { plannedDate: "soon" })).status).toBe(400);
  });

  it("returns a departure and misses when stops have light preferences", async () => {
    // Yosemite-ish; 1 degree of latitude is ~1.2 h at the fake speed.
    const coords = [[-119.6, 37.7], [-119.6, 38.7], [-119.6, 39.7]];
    const res = await post(coords, {
      plannedDate: "2026-07-01",
      stops: [
        { lightPref: "any", dwellMinutes: 30 },
        { lightPref: "any", dwellMinutes: 30 },
        { lightPref: "sunset", dwellMinutes: 30 },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.order).toEqual([0, 1, 2]);
    expect(typeof body.departAt).toBe("string");
    expect(Number.isNaN(Date.parse(body.departAt))).toBe(false);
    expect(body.misses).toEqual([]);
    // Sunset light at the last stop pushes the departure well past sunrise (~12:50 UTC).
    expect(Date.parse(body.departAt)).toBeGreaterThan(Date.parse("2026-07-01T18:00:00Z"));
  });

  it("reports stops whose light cannot be met", async () => {
    const coords = [[-119.6, 37.7], [-119.6, 38.7], [-119.6, 39.7]];
    const res = await post(coords, {
      plannedDate: "2026-07-01",
      stops: [
        { lightPref: "sunrise", dwellMinutes: 480 },
        { lightPref: "sunrise", dwellMinutes: 30 },
        { lightPref: "sunrise", dwellMinutes: 30 },
      ],
    });
    const body = await res.json();
    expect(body.misses.length).toBeGreaterThan(0);
    expect(body.misses[0]).toEqual({ stopIndex: expect.any(Number), minutes: expect.any(Number) });
  });

  it("returns 502 with the user-safe message when Mapbox fails", async () => {
    vi.mocked(getDurationMatrix).mockRejectedValue(new ExternalServiceError("Couldn't calculate drive times. Please try again."));
    const res = await post([[0, 0], [0, 1], [0, 2]]);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Couldn't calculate drive times. Please try again." });
  });
});
