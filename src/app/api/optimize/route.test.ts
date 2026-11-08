import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/external/place-notices", () => ({ collectPlaceNotices: vi.fn(async () => []) }));
vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/server/shared-limit", () => ({ enforcePaidLimit: vi.fn() }));
vi.mock("@/server/external/mapbox", async (orig) => ({ ...(await orig<typeof import("@/server/external/mapbox")>()), getDurationMatrix: vi.fn() }));
import { getCurrentUserId } from "@/server/session";
import { enforcePaidLimit } from "@/server/shared-limit";
import { getDurationMatrix } from "@/server/external/mapbox";
import { POST } from "./route";

const post = () =>
  new Request("http://localhost/api/optimize", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify({ coordinates: [[0, 0], [1, 1], [2, 2]] }),
  });
const matrix = [[0, 1, 2], [1, 0, 1], [2, 1, 0]];

describe("POST /api/optimize: busy answer", () => {
  beforeEach(() => {
    vi.stubEnv("OPTIMIZE_MAX_CONCURRENT", "1");
    vi.mocked(getCurrentUserId).mockResolvedValue("u1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(getDurationMatrix).mockReset();
    vi.mocked(enforcePaidLimit).mockReset();
  });

  it("a 503 busy answer neither calls Mapbox nor uses up the user's limit", async () => {
    let release!: () => void;
    vi.mocked(getDurationMatrix).mockImplementationOnce(() => new Promise((r) => (release = () => r(matrix))));
    const first = POST(post());
    await vi.waitFor(() => expect(getDurationMatrix).toHaveBeenCalledTimes(1));
    expect(enforcePaidLimit).toHaveBeenCalledTimes(1);

    const busy = await POST(post());
    expect(busy.status).toBe(503);
    expect(busy.headers.get("Retry-After")).toBeTruthy();
    expect(getDurationMatrix).toHaveBeenCalledTimes(1);
    expect(enforcePaidLimit).toHaveBeenCalledTimes(1);

    release();
    expect((await first).status).toBe(200);
  });
});

describe("POST /api/optimize: Start from my location keeps the daylight check", () => {
  beforeEach(() => vi.mocked(getCurrentUserId).mockResolvedValue("u1"));
  afterEach(() => vi.mocked(getDurationMatrix).mockReset());

  it("moves a saved start that is after sunset, with the origin as without it", async () => {
    const coordinates = [[-119.8, 36.7], [-119.7, 36.8], [-119.6, 36.9]];
    const body = (origin?: { lat: number; lng: number }) =>
      new Request("http://localhost/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: JSON.stringify({ coordinates, plannedDate: "2026-07-01", departAt: "2026-07-02T04:30:00Z", stops: [0, 1, 2].map(() => ({ lightPref: "any", priority: "normal", dwellMinutes: 30 })), ...(origin ? { origin } : {}) }),
      });
    vi.mocked(getDurationMatrix).mockResolvedValueOnce(matrix);
    const plain = await (await POST(body())).json();
    vi.mocked(getDurationMatrix).mockResolvedValueOnce([[0, 600, 1200, 1800], [600, 0, 1, 2], [1200, 1, 0, 1], [1800, 2, 1, 0]]);
    const withOrigin = await (await POST(body({ lat: 36.65, lng: -119.85 }))).json();
    expect(plain.departAt ?? null).not.toBeNull();
    expect(withOrigin.departAt ?? null).not.toBeNull(); // used to be null: the saved start was ignored, so the dark trip was left dark
  });

  it("keeps the saved start when the chosen first drive is not the nearest one", async () => {
    const coordinates = [[-119.8, 36.7], [-119.7, 36.8], [-119.6, 36.9]];
    const departAt = "2026-07-02T01:41:00.000Z";
    const req = new Request("http://localhost/api/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({
        coordinates,
        plannedDate: "2026-07-01",
        departAt,
        origin: { lat: 36.65, lng: -119.85 },
        stops: [{ lightPref: "any", priority: "normal", dwellMinutes: 30 }, { lightPref: "sunset", priority: "normal", dwellMinutes: 30 }, { lightPref: "any", priority: "normal", dwellMinutes: 30 }],
      }),
    });
    // The nearest drive from the origin is to stop 1 (600 s), but reordering for it gains too little to beat keeping the order, so the first drive is stop 0's (700 s).
    vi.mocked(getDurationMatrix).mockResolvedValueOnce([
      [0, 700, 600, 900],
      [700, 0, 600, 600],
      [600, 600, 0, 600],
      [900, 600, 600, 0],
    ]);
    const body = await (await POST(req)).json();
    expect(body.order).toEqual([0, 1, 2]);
    expect(body.departAt).toBe(departAt);
  });
});
