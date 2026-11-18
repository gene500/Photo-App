import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/server/stop-access", () => ({ resolveStopAccess: vi.fn() }));
import { getCurrentUserId } from "@/server/session";
import { resolveStopAccess } from "@/server/stop-access";
import { enforceLimit, resetLimit } from "@/server/rate-limit";
import { POST } from "./route";

const post = () =>
  POST(new Request("http://localhost/api/stops/s1/access", { method: "POST", headers: { Origin: "http://localhost" } }), { params: Promise.resolve({ id: "s1" }) });

describe("POST /api/stops/[id]/access", () => {
  beforeEach(() => vi.mocked(getCurrentUserId).mockResolvedValue("u-access-route"));
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.RATE_LIMIT_DISABLED;
    resetLimit("access", "u-access-route");
    resetLimit("hike", "u-access-route");
  });

  it("is 401 with no session", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(null);
    expect((await post()).status).toBe(401);
    expect(resolveStopAccess).not.toHaveBeenCalled();
  });

  it("returns the stop with its access point for the owner", async () => {
    vi.mocked(resolveStopAccess).mockResolvedValue({ id: "s1", access: { lat: 1, lng: 2, name: "Lot" } } as never);
    const res = await post();
    expect(res.status).toBe(200);
    expect((await res.json()).stop.access).toEqual({ lat: 1, lng: 2, name: "Lot" });
    expect(resolveStopAccess).toHaveBeenCalledWith("u-access-route", "s1");
  });

  it("is 404 for a stop of another user", async () => {
    vi.mocked(resolveStopAccess).mockResolvedValue(null);
    expect((await post()).status).toBe(404);
  });

  it("has its own 60 a minute limit that does not use up the hike limit", async () => {
    process.env.RATE_LIMIT_DISABLED = "0";
    vi.mocked(resolveStopAccess).mockResolvedValue({ id: "s1" } as never);
    for (let i = 0; i < 60; i++) expect((await post()).status).toBe(200);
    const res = await post();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(() => enforceLimit("hike", "u-access-route")).not.toThrow();
  });
});
