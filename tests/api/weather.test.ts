import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/server/external/weather", () => ({ getForecast: vi.fn() }));
import { getCurrentUserId } from "@/server/session";
import { getForecast } from "@/server/external/weather";
import { GET } from "@/app/api/weather/route";

const url = (qs: string) => new Request(`http://localhost/api/weather?${qs}`);
const forecast = { available: true as const, utcOffsetSeconds: -25200, hours: [{ time: "2026-07-01T19:00", cloudPct: 30, rainPct: 15, tempC: 17.2 }] };

describe("GET /api/weather", () => {
  beforeEach(() => vi.mocked(getCurrentUserId).mockResolvedValue("u1"));
  afterEach(() => vi.mocked(getForecast).mockReset());

  it("requires sign-in and does not look anything up", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(null);
    const res = await GET(url("lat=1&lng=2&date=2026-07-01"));
    expect(res.status).toBe(401);
    expect(getForecast).not.toHaveBeenCalled();
  });

  it("returns the forecast with a private 30-minute cache header", async () => {
    vi.mocked(getForecast).mockResolvedValue(forecast);
    const res = await GET(url("lat=37.7749&lng=-122.4194&date=2026-07-01"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=1800");
    expect(await res.json()).toEqual({ forecast });
    expect(getForecast).toHaveBeenCalledWith(37.7749, -122.4194, "2026-07-01");
  });

  it("passes through out_of_range with a short cache", async () => {
    vi.mocked(getForecast).mockResolvedValue({ available: false, reason: "out_of_range" });
    const res = await GET(url("lat=1&lng=2&date=2030-01-01"));
    expect(await res.json()).toEqual({ forecast: { available: false, reason: "out_of_range" } });
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=300");
  });

  it("caches a failed lookup for only a minute", async () => {
    vi.mocked(getForecast).mockResolvedValue({ available: false, reason: "unavailable" });
    const res = await GET(url("lat=1&lng=2&date=2026-07-01"));
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=60");
  });

  it.each([
    "lng=2&date=2026-07-01",
    "lat=1&date=2026-07-01",
    "lat=1&lng=2",
    "lat=91&lng=2&date=2026-07-01",
    "lat=1&lng=181&date=2026-07-01",
    "lat=abc&lng=2&date=2026-07-01",
    "lat=1&lng=2&date=2026-7-1",
    "lat=1&lng=2&date=2026-02-30",
    "lat=1&lng=2&date=tomorrow",
  ])("rejects %s with 400", async (qs) => {
    const res = await GET(url(qs));
    expect(res.status).toBe(400);
    expect(getForecast).not.toHaveBeenCalled();
  });
});
