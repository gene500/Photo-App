import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/external/place-notices", () => ({ collectPlaceNotices: vi.fn(async () => []) }));
vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/server/shared-limit", () => ({ enforcePaidLimit: vi.fn() }));
vi.mock("@/server/external/mapbox", async (orig) => ({ ...(await orig<typeof import("@/server/external/mapbox")>()), getDurationMatrix: vi.fn() }));
import { getCurrentUserId } from "@/server/session";
import { enforcePaidLimit } from "@/server/shared-limit";
import { getDurationMatrix } from "@/server/external/mapbox";
import { getSunWindows } from "@/lib/best-time";
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

describe("POST /api/optimize: rounded start keeps the light windows met", () => {
  beforeEach(() => vi.mocked(getCurrentUserId).mockResolvedValue("u1"));
  afterEach(() => vi.mocked(getDurationMatrix).mockReset());

  it("re-posting the returned start with a fixed departure gives no new miss", async () => {
    const coordinates = [[-120.5, 36.5], [-120.1, 36.9], [-119.6, 37.2], [-120.1, 36.91]];
    const km = (a: number[], b: number[]) => Math.hypot((a[0]! - b[0]!) * 89, (a[1]! - b[1]!) * 111);
    const post = (extra: object) =>
      POST(
        new Request("http://localhost/api/optimize", {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "http://localhost" },
          body: JSON.stringify({
            coordinates,
            plannedDate: "2026-12-01",
            stops: coordinates.map((_, i) => ({ lightPref: i === 3 ? "golden" : "any", priority: "normal", dwellMinutes: 30 })),
            ...extra,
          }),
        }),
      );
    const total = (r: { misses: { minutes: number }[] }) => r.misses.reduce((s, m) => s + m.minutes, 0);
    // Several speeds, so the searched start lands on all kinds of seconds.
    for (let kmh = 37; kmh <= 113; kmh += 4) {
      vi.mocked(getDurationMatrix).mockResolvedValue(coordinates.map((a) => coordinates.map((b) => Math.round((km(a, b) / kmh) * 3600) + 7)));
      const first = await (await post({})).json();
      const again = await (await post({ departAt: first.departAt, fixDeparture: true })).json();
      expect(total(again), `${kmh} km/h`).toBeLessThanOrEqual(total(first));
    }
  });
});

describe("POST /api/optimize: walkMinutes (walk from the parking lot)", () => {
  beforeEach(() => vi.mocked(getCurrentUserId).mockResolvedValue("u1"));
  afterEach(() => vi.mocked(getDurationMatrix).mockReset());

  const coordinates = [[-119.8, 36.7], [-119.7, 36.8]];
  const goldenEnd = getSunWindows(36.7, -119.8, "2026-07-01").goldenHourEnd!;
  // The car reaches the first stop's lot 5 min before morning golden hour ends, and the start is kept as saved.
  const req = (walkMinutes?: unknown) =>
    new Request("http://localhost/api/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({
        coordinates,
        plannedDate: "2026-07-01",
        departAt: new Date(goldenEnd.getTime() - 5 * 60_000).toISOString(),
        fixDeparture: true,
        stops: [
          { lightPref: "sunrise", priority: "normal", dwellMinutes: 30, ...(walkMinutes === undefined ? {} : { walkMinutes }) },
          { lightPref: "any", priority: "normal", dwellMinutes: 30 },
        ],
      }),
    });

  it("an old payload without the field behaves as before (no miss)", async () => {
    vi.mocked(getDurationMatrix).mockResolvedValueOnce([[0, 600], [600, 0]]);
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect((await res.json()).misses).toEqual([]);
  });

  it("a walk of 30 min makes the sunrise stop miss by the walk, judged at the subject", async () => {
    vi.mocked(getDurationMatrix).mockResolvedValueOnce([[0, 600], [600, 0]]);
    const res = await POST(req(30));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.misses).toEqual([{ stopIndex: 0, minutes: 25, priority: "normal" }]);
  });

  it("walkMinutes 0 equals no field", async () => {
    vi.mocked(getDurationMatrix).mockResolvedValueOnce([[0, 600], [600, 0]]);
    expect((await (await POST(req(0))).json()).misses).toEqual([]);
  });

  it("rejects values that are negative, fractional, too big or not numbers", async () => {
    for (const bad of [-1, 2.5, 301, "30", null, Infinity]) {
      const res = await POST(req(bad));
      expect(res.status, String(bad)).toBe(400);
    }
    expect(getDurationMatrix).not.toHaveBeenCalled();
  });
});
