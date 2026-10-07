import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/server/external/mapbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/external/mapbox")>()),
  reverseGeocode: vi.fn(),
}));
import { getCurrentUserId } from "@/server/session";
import { ExternalServiceError, reverseGeocode } from "@/server/external/mapbox";
import { GET } from "@/app/api/reverse-geocode/route";

const url = (qs: string) => new Request(`http://localhost/api/reverse-geocode?${qs}`);

describe("GET /api/reverse-geocode", () => {
  beforeEach(() => vi.mocked(getCurrentUserId).mockResolvedValue("u1"));

  it("returns the place at a point", async () => {
    vi.mocked(reverseGeocode).mockResolvedValue({ name: "Tunnel View", lat: 37.5, lng: -119.5 });
    const res = await GET(url("lat=37.5&lng=-119.5"));
    expect(await res.json()).toEqual({ place: { name: "Tunnel View", lat: 37.5, lng: -119.5 } });
    expect(reverseGeocode).toHaveBeenCalledWith({ lat: 37.5, lng: -119.5 });
  });

  it("rejects missing or out-of-range coordinates", async () => {
    expect((await GET(url("lat=95&lng=0"))).status).toBe(400);
    expect((await GET(url(""))).status).toBe(400);
    expect((await GET(url("lat=&lng="))).status).toBe(400);
    expect((await GET(url("lat=1e2&lng=0x10"))).status).toBe(400);
    expect((await GET(url("lat=%20&lng=3"))).status).toBe(400);
  });

  it("maps upstream failures to 502", async () => {
    vi.mocked(reverseGeocode).mockRejectedValue(new ExternalServiceError("Place lookup failed. Please try again."));
    const res = await GET(url("lat=37.5&lng=-119.5"));
    expect(res.status).toBe(502);
  });

  it("requires sign-in", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(null);
    expect((await GET(url("lat=37.5&lng=-119.5"))).status).toBe(401);
  });
});
