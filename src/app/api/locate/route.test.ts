import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/server/shared-limit", () => ({ enforcePaidLimit: vi.fn() }));
vi.mock("@/server/external/mapbox", async (orig) => ({ ...(await orig<typeof import("@/server/external/mapbox")>()), locateArea: vi.fn(), locateLandmark: vi.fn() }));
import { getCurrentUserId } from "@/server/session";
import { enforcePaidLimit } from "@/server/shared-limit";
import { ExternalServiceError, locateArea, locateLandmark } from "@/server/external/mapbox";
import { GET } from "./route";

const get = (q?: string) => GET(new Request(`http://localhost/api/locate${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`));

describe("GET /api/locate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserId).mockResolvedValue("u1");
    vi.mocked(locateArea).mockResolvedValue({ lat: 34.05, lng: -118.24 });
    vi.mocked(locateLandmark).mockResolvedValue(null);
  });

  it("requires sign-in", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(null);
    expect((await get("LA")).status).toBe(401);
  });

  it("counts against the shared paid limiter and returns the area", async () => {
    const res = await get("LA");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ area: { lat: 34.05, lng: -118.24 }, landmark: null });
    expect(enforcePaidLimit).toHaveBeenCalledWith("locate", "u1");
  });

  it("adds the park or landmark when the name is one, and never fails because of its lookup", async () => {
    vi.mocked(locateLandmark).mockResolvedValue({ name: "Arches National Park", lat: 38.7, lng: -109.6 });
    expect((await (await get("Arches National Park")).json()).landmark).toEqual({ name: "Arches National Park", lat: 38.7, lng: -109.6 });
    vi.mocked(locateLandmark).mockRejectedValue(new ExternalServiceError("down"));
    const res = await get("Arches National Park");
    expect(res.status).toBe(200);
    expect((await res.json()).landmark).toBeNull();
  });

  it("rejects a missing or too-short query and passes service errors on as 502", async () => {
    expect((await get()).status).toBe(400);
    expect((await get("x")).status).toBe(400);
    vi.mocked(locateArea).mockRejectedValue(new ExternalServiceError("down"));
    expect((await get("LA")).status).toBe(502);
  });

  it("does not count a malformed query against the paid limit", async () => {
    await get("x");
    await get();
    expect(enforcePaidLimit).not.toHaveBeenCalled();
  });

  it("still answers with the landmark when only the area lookup fails", async () => {
    vi.mocked(locateArea).mockRejectedValue(new ExternalServiceError("down"));
    vi.mocked(locateLandmark).mockResolvedValue({ name: "Arches National Park", lat: 38.7, lng: -109.6 });
    const res = await get("Arches National Park");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ area: { lat: 38.7, lng: -109.6 }, landmark: { name: "Arches National Park", lat: 38.7, lng: -109.6 } });
  });
});
