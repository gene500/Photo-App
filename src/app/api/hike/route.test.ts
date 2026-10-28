import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/server/hike/service", () => ({ getHike: vi.fn() }));
import { getCurrentUserId } from "@/server/session";
import { getHike } from "@/server/hike/service";
import { resetLimit } from "@/server/rate-limit";
import { GET } from "./route";

const get = (qs: string) => GET(new Request(`http://localhost/api/hike?${qs}`));
const HIKE = { distanceMeters: 1930, geometry: [[-119.52, 36.996], [-119.5, 37]], source: "osm", attribution: "Trail data © OpenStreetMap contributors" };

describe("GET /api/hike", () => {
  beforeEach(() => vi.mocked(getCurrentUserId).mockResolvedValue("u-hike"));
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.RATE_LIMIT_DISABLED;
    resetLimit("hike", "u-hike");
  });

  it("answers the hike with a private cache header", async () => {
    vi.mocked(getHike).mockResolvedValue(HIKE as never);
    const res = await get("lat=37&lng=-119.5");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hike: HIKE });
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=3600");
    expect(getHike).toHaveBeenCalledWith(37, -119.5);
  });

  it("answers { hike: null } with a shorter cache when there is none", async () => {
    vi.mocked(getHike).mockResolvedValue(null);
    const res = await get("lat=37&lng=-119.5");
    expect(await res.json()).toEqual({ hike: null });
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=60");
  });

  it("is 401 when signed out", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(null);
    expect((await get("lat=37&lng=-119.5")).status).toBe(401);
    expect(getHike).not.toHaveBeenCalled();
  });

  it.each(["", "lat=37", "lng=1", "lat=abc&lng=1", "lat=91&lng=0", "lat=0&lng=181", "lat=1e3&lng=0"])("is 400 for %j", async (qs) => {
    expect((await get(qs)).status).toBe(400);
    expect(getHike).not.toHaveBeenCalled();
  });

  it("is limited to 60 a minute per user, with Retry-After", async () => {
    process.env.RATE_LIMIT_DISABLED = "0";
    vi.mocked(getHike).mockResolvedValue(null);
    for (let i = 0; i < 60; i++) expect((await get("lat=37&lng=-119.5")).status).toBe(200);
    const res = await get("lat=37&lng=-119.5");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });
});
