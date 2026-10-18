import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/server/shared-limit", () => ({ enforcePaidLimit: vi.fn() }));
vi.mock("@/server/external/mapbox", async (orig) => ({ ...(await orig<typeof import("@/server/external/mapbox")>()), reverseGeocode: vi.fn() }));
import { getCurrentUserId } from "@/server/session";
import { enforcePaidLimit } from "@/server/shared-limit";
import { reverseGeocode } from "@/server/external/mapbox";
import { GET } from "./route";

describe("GET /api/reverse-geocode", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUserId).mockResolvedValue("u1");
    vi.mocked(reverseGeocode).mockResolvedValue({ name: "Somewhere", lat: 1, lng: 2 });
  });

  it("counts against the shared paid limiter", async () => {
    const res = await GET(new Request("http://localhost/api/reverse-geocode?lat=1&lng=2"));
    expect(res.status).toBe(200);
    expect(enforcePaidLimit).toHaveBeenCalledWith("reverse-geocode", "u1");
  });
});
