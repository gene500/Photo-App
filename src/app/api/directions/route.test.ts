import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/server/shared-limit", () => ({ enforcePaidLimit: vi.fn() }));
vi.mock("@/server/budget", async (orig) => ({ ...(await orig<typeof import("@/server/budget")>()), spendBudget: vi.fn() }));
import { getCurrentUserId } from "@/server/session";
import { spendBudget } from "@/server/budget";
import { clearMapboxCaches } from "@/server/external/mapbox";
import { HttpError } from "@/server/http";
import { POST } from "./route";

describe("POST /api/directions budget", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUserId).mockResolvedValue("u1");
    clearMapboxCaches();
    delete process.env.EXTERNAL_APIS_FAKE;
    process.env.MAPBOX_TOKEN = "test-token";
  });

  it("returns a used-up budget as a 429 with its own message", async () => {
    const message = "Mapbox directions is used up for this month. It resets on December 1, 2026.";
    vi.mocked(spendBudget).mockRejectedValue(new HttpError(429, message));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await POST(new Request("http://localhost/api/directions", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ coordinates: [[-119.5, 37.7], [-119.6, 37.8]] }),
    }));
    expect(res.status).toBe(429);
    expect(JSON.stringify(await res.json())).toContain(message);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
