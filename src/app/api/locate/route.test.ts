import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/server/shared-limit", () => ({ enforcePaidLimit: vi.fn() }));
vi.mock("@/server/external/mapbox", async (orig) => ({ ...(await orig<typeof import("@/server/external/mapbox")>()), locateArea: vi.fn() }));
import { getCurrentUserId } from "@/server/session";
import { enforcePaidLimit } from "@/server/shared-limit";
import { ExternalServiceError, locateArea } from "@/server/external/mapbox";
import { GET } from "./route";

const get = (q?: string) => GET(new Request(`http://localhost/api/locate${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`));

describe("GET /api/locate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserId).mockResolvedValue("u1");
    vi.mocked(locateArea).mockResolvedValue({ lat: 34.05, lng: -118.24 });
  });

  it("requires sign-in", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(null);
    expect((await get("LA")).status).toBe(401);
  });

  it("counts against the shared paid limiter and returns the area", async () => {
    const res = await get("LA");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ area: { lat: 34.05, lng: -118.24 } });
    expect(enforcePaidLimit).toHaveBeenCalledWith("locate", "u1");
  });

  it("rejects a missing or too-short query and passes service errors on as 502", async () => {
    expect((await get()).status).toBe(400);
    expect((await get("x")).status).toBe(400);
    vi.mocked(locateArea).mockRejectedValue(new ExternalServiceError("down"));
    expect((await get("LA")).status).toBe(502);
  });
});
