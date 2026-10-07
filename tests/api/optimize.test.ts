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

const post = (coordinates: unknown) => POST(jsonRequest("POST", "/api/optimize", { coordinates }));

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
    expect(await res.json()).toEqual({ order: [0, 2, 3, 1] });
  });

  it("returns 502 with the user-safe message when Mapbox fails", async () => {
    vi.mocked(getDurationMatrix).mockRejectedValue(new ExternalServiceError("Couldn't calculate drive times. Please try again."));
    const res = await post([[0, 0], [0, 1], [0, 2]]);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Couldn't calculate drive times. Please try again." });
  });
});
