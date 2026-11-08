import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/server/shared-limit", () => ({ enforcePaidLimit: vi.fn() }));
vi.mock("@/server/external/mapbox", async (orig) => ({ ...(await orig<typeof import("@/server/external/mapbox")>()), searchPlaces: vi.fn() }));
import { getCurrentUserId } from "@/server/session";
import { searchPlaces } from "@/server/external/mapbox";
import { GET } from "./route";

const get = () => GET(new Request("http://localhost/api/geocode?q=yosemite&session=3f2b8c1e-9d4a-4b6f-8a1c-2e7d5f0a9b11"));

describe("GET /api/geocode", () => {
  beforeEach(() => vi.mocked(getCurrentUserId).mockResolvedValue("u-geocode"));
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("answers the suggestions", async () => {
    vi.mocked(searchPlaces).mockResolvedValue([]);
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suggestions: [] });
  });

  it("answers 502 within 12 s when the upstream hangs", async () => {
    vi.useFakeTimers();
    vi.mocked(searchPlaces).mockReturnValue(new Promise(() => {}));
    const p = get();
    await vi.advanceTimersByTimeAsync(12_000);
    const res = await p;
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Couldn't reach the place search service" });
  });
});
