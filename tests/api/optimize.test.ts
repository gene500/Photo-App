import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/server/external/mapbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/external/mapbox")>()),
  getDurationMatrix: vi.fn(),
}));
import { solarDateAt } from "@/lib/best-time";
import { getCurrentUserId } from "@/server/session";
import { ExternalServiceError, getDurationMatrix } from "@/server/external/mapbox";
import { POST } from "@/app/api/optimize/route";
import { fakeDurationMatrix } from "@/server/external/fake";
import { jsonRequest } from "../helpers/requests";

const post = (coordinates: unknown, extra: object = {}) => POST(jsonRequest("POST", "/api/optimize", { coordinates, ...extra }));

describe("POST /api/optimize", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUserId).mockResolvedValue("u1");
    vi.mocked(getDurationMatrix).mockImplementation(async (c) => fakeDurationMatrix(c));
  });
  afterEach(() => vi.mocked(getDurationMatrix).mockReset());

  it("requires sign-in", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(null);
    expect((await post([[0, 0], [0, 1], [0, 2]])).status).toBe(401);
  });

  it("needs at least 2 stops and at most 25, and can time a two-stop trip", async () => {
    expect((await post([[0, 0]])).status).toBe(400);
    expect((await post([[0, 0], [0, 1]])).status).toBe(200);
    expect((await post(Array.from({ length: 26 }, (_, i) => [i * 0.01, 0]))).status).toBe(400);
    expect((await post([[0, 0], [0, 1], [200, 2]])).status).toBe(400);
  });

  it("accepts the focus setting and rejects unknown values", async () => {
    const line = [[0, 0], [0, 3], [0, 1], [0, 2]];
    expect((await post(line, { focus: "time" })).status).toBe(200);
    expect((await post(line, { focus: "priority" })).status).toBe(200);
    expect((await post(line, { focus: "bogus" })).status).toBe(400);
  });

  it("returns indices that sort a shuffled line, keeping the start first", async () => {
    // lat 0, 3, 1, 2 along one meridian
    const res = await post([[0, 0], [0, 3], [0, 1], [0, 2]]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ order: [0, 2, 3, 1], complete: true, departAt: null, misses: [], dark: [], polar: [] });
  });

  it("rejects a stops list whose length differs from the coordinates", async () => {
    const res = await post([[0, 0], [0, 1], [0, 2]], { stops: [{ lightPref: "any", dwellMinutes: 30 }] });
    expect(res.status).toBe(400);
    expect((await post([[0, 0], [0, 1], [0, 2]], { stops: [1, 2, 3].map(() => ({ lightPref: "dusk", dwellMinutes: 30 })) })).status).toBe(400);
    expect((await post([[0, 0], [0, 1], [0, 2]], { plannedDate: "soon" })).status).toBe(400);
  });

  it("rejects a fixDeparture that is not a boolean", async () => {
    expect((await post([[0, 0], [0, 1], [0, 2]], { fixDeparture: "yes" })).status).toBe(400);
  });

  it("keeps the given start when asked to fix the departure", async () => {
    const coords = [[-119.6, 37.7], [-119.6, 38.7], [-119.6, 39.7]];
    const departAt = "2026-07-01T22:00:00.000Z";
    const res = await post(coords, {
      plannedDate: "2026-07-01",
      departAt,
      fixDeparture: true,
      stops: [
        { lightPref: "any", dwellMinutes: 30 },
        { lightPref: "sunrise", dwellMinutes: 30 },
        { lightPref: "sunset", dwellMinutes: 30 },
      ],
    });
    expect(res.status).toBe(200);
    expect((await res.json()).departAt).toBe(departAt);
  });

  it("returns a departure and misses when stops have light preferences", async () => {
    // Yosemite-ish; 1 degree of latitude is ~1.2 h at the fake speed.
    const coords = [[-119.6, 37.7], [-119.6, 38.7], [-119.6, 39.7]];
    const res = await post(coords, {
      plannedDate: "2026-07-01",
      stops: [
        { lightPref: "any", dwellMinutes: 30 },
        { lightPref: "any", dwellMinutes: 30 },
        { lightPref: "sunset", dwellMinutes: 30 },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.order).toEqual([0, 1, 2]);
    expect(typeof body.departAt).toBe("string");
    expect(Number.isNaN(Date.parse(body.departAt))).toBe(false);
    expect(body.misses).toEqual([]);
    // Sunset light at the last stop pushes the departure well past sunrise (~12:50 UTC).
    expect(Date.parse(body.departAt)).toBeGreaterThan(Date.parse("2026-07-01T18:00:00Z"));
  });

  it("returns a departure on a whole minute, like the Start time field", async () => {
    const coords = [[-119.6, 37.7], [-119.6, 38.7], [-119.6, 39.7]];
    for (const lightPref of ["sunrise", "golden", "sunset"] as const) {
      const body = await (await post(coords, {
        plannedDate: "2026-07-01",
        stops: [{ lightPref, dwellMinutes: 30 }, { lightPref: "any", dwellMinutes: 30 }, { lightPref: "any", dwellMinutes: 30 }],
      })).json();
      expect(Date.parse(body.departAt) % 60_000, lightPref).toBe(0);
    }
  });

  describe("with a saved departure", () => {
    const coords = [[-119.6, 37.7], [-119.6, 38.7], [-119.6, 39.7]];
    const lights = (last: string) => [
      { lightPref: "any", dwellMinutes: 30 },
      { lightPref: "any", dwellMinutes: 30 },
      { lightPref: last, dwellMinutes: 30 },
    ];

    it("keeps it when it already meets every light window", async () => {
      const departAt = "2026-07-01T23:52:00.000Z";
      const body = await (await post(coords, { plannedDate: "2026-07-01", stops: lights("sunset"), departAt })).json();
      expect(body.misses).toEqual([]);
      expect(body.departAt).toBe(departAt);
    });

    it("changes it when it does not meet the light", async () => {
      const departAt = "2026-07-01T12:00:00.000Z";
      const body = await (await post(coords, { plannedDate: "2026-07-01", stops: lights("sunset"), departAt })).json();
      expect(body.misses).toEqual([]);
      expect(body.departAt).not.toBe(departAt);
    });

    it("never answers with a start time outside the planned solar day", async () => {
      // A saved start on the next solar day (or one the search could pick there) would be refused when saved to the trip.
      for (const departAt of ["2026-07-02T09:00:00.000Z", "2026-06-30T12:00:00.000Z"]) {
        const body = await (await post(coords, { plannedDate: "2026-07-01", stops: lights("sunset"), departAt })).json();
        expect(solarDateAt(new Date(body.departAt), -119.6)).toBe("2026-07-01");
      }
    });

    it("rejects a malformed departAt", async () => {
      expect((await post(coords, { departAt: "tomorrow" })).status).toBe(400);
    });
  });

  it("reports stops whose light cannot be met", async () => {
    const coords = [[-119.6, 37.7], [-119.6, 38.7], [-119.6, 39.7]];
    const res = await post(coords, {
      plannedDate: "2026-07-01",
      stops: [
        { lightPref: "sunrise", dwellMinutes: 480 },
        { lightPref: "sunrise", dwellMinutes: 30 },
        { lightPref: "sunrise", dwellMinutes: 30 },
      ],
    });
    const body = await res.json();
    expect(body.misses.length).toBeGreaterThan(0);
    expect(body.misses[0]).toEqual({ stopIndex: expect.any(Number), minutes: expect.any(Number), priority: "normal" });
  });

  describe("daylight", () => {
    const coords = [[-119.6, 37.7], [-119.6, 38.7], [-119.6, 39.7]];
    const anyStops = [0, 1, 2].map(() => ({ lightPref: "any", dwellMinutes: 30 }));
    const night = "2026-07-01T09:00:00.000Z"; // 1 am solar time at the first stop

    it("moves the start so no visit is in the dark, even when no stop has a light preference", async () => {
      const body = await (await post(coords, { plannedDate: "2026-07-01", stops: anyStops, departAt: night })).json();
      expect(typeof body.departAt).toBe("string");
      expect(body.departAt).not.toBe(night);
      expect(body.dark).toEqual([]);
    });

    it("only reports the dark visits under the time focus, and leaves the start alone", async () => {
      const body = await (await post(coords, { plannedDate: "2026-07-01", stops: anyStops, departAt: night, focus: "time" })).json();
      expect(body.departAt).toBeNull();
      expect(body.order).toEqual([0, 1, 2]);
      expect(body.dark.length).toBeGreaterThan(0);
      expect(body.dark[0]).toEqual({ stopIndex: expect.any(Number), minutes: expect.any(Number), priority: "normal" });
    });

    it("names the stops where the sun neither rises nor sets that day, and applies no daylight rule to them", async () => {
      const arctic = [[15, 78], [15, 78.5], [15, 79]];
      const body = await (await post(arctic, { plannedDate: "2026-06-21", stops: anyStops, departAt: night })).json();
      expect(body.polar).toEqual([0, 1, 2]);
      expect(body.dark).toEqual([]);
      expect(body.departAt).toBeNull();
    });

    it("does not move the start for polar stops that ask for sunrise or sunset light", async () => {
      const arctic = [[15, 78], [15, 78.5], [15, 79]];
      const lit = anyStops.map((s) => ({ ...s, lightPref: "sunset" }));
      const body = await (await post(arctic, { plannedDate: "2026-06-21", stops: lit, departAt: night })).json();
      expect(body.polar).toEqual([0, 1, 2]);
      expect(body.departAt).toBeNull();
    });

    it("leaves polar empty and the start untouched for an ordinary daylight trip", async () => {
      const body = await (await post(coords, { plannedDate: "2026-07-01", stops: anyStops })).json();
      expect(body.polar).toEqual([]);
      expect(body.dark).toEqual([]);
      expect(body.departAt).toBeNull();
    });
  });

  it("returns 502 with the user-safe message when Mapbox fails", async () => {
    vi.mocked(getDurationMatrix).mockRejectedValue(new ExternalServiceError("Couldn't calculate drive times. Please try again."));
    const res = await post([[0, 0], [0, 1], [0, 2]]);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Couldn't calculate drive times. Please try again." });
  });

  describe("server-wide load protection", () => {
    // 25 stops with light preferences is the heaviest request the schema allows.
    const heavy = () => {
      const coords = Array.from({ length: 25 }, (_, i) => [-119.6 + (i % 5) * 0.05, 37.7 + Math.floor(i / 5) * 0.05]);
      const kinds = ["any", "sunrise", "sunset", "golden"] as const;
      return post(coords, {
        plannedDate: "2026-07-01",
        stops: coords.map((_, i) => ({ lightPref: i === 0 ? "any" : kinds[i % 4], dwellMinutes: 30, priority: "must" })),
      });
    };

    it("runs at most 2 optimizations at once and turns the rest away with 503 + Retry-After and a clear message", async () => {
      const results = await Promise.all([heavy(), heavy(), heavy(), heavy(), heavy()]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((x) => x === 200).length).toBe(2);
      expect(statuses.filter((x) => x === 503).length).toBe(3);
      const busy = results.find((r) => r.status === 503)!;
      expect(Number(busy.headers.get("Retry-After"))).toBeGreaterThan(0);
      expect((await busy.json()).error).toMatch(/busy/i);
      // The slots are free again afterwards.
      expect((await heavy()).status).toBe(200);
    });

    it("releases the slot when the solve fails", async () => {
      vi.mocked(getDurationMatrix).mockRejectedValue(new ExternalServiceError("down"));
      for (let i = 0; i < 5; i++) expect((await post([[0, 0], [0, 1], [0, 2]])).status).toBe(502);
      vi.mocked(getDurationMatrix).mockImplementation(async (c) => fakeDurationMatrix(c));
      expect((await post([[0, 0], [0, 1], [0, 2]])).status).toBe(200);
    });

    it("does not stall other requests while a heavy optimization runs", async () => {
      let worst = 0;
      let last = performance.now();
      const timer = setInterval(() => {
        const now = performance.now();
        worst = Math.max(worst, now - last);
        last = now;
      }, 1);
      try {
        await Promise.all([heavy(), heavy()]);
        await new Promise((r) => setTimeout(r, 10)); // let the timer record a gap that ended with the work
      } finally {
        clearInterval(timer);
      }
      expect(worst).toBeLessThan(250); // the blocking solver held it for ~1 s here
    });

    it("reports complete: false when the time budget cut the search short, true otherwise", async () => {
      expect((await (await heavy()).json()).complete).toBe(true);
      vi.stubEnv("OPTIMIZE_BUDGET_MS", "1");
      try {
        const body = await (await heavy()).json();
        expect(body.complete).toBe(false);
        expect([...body.order].sort((a: number, b: number) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i));
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("honours OPTIMIZE_MAX_CONCURRENT", async () => {
      vi.stubEnv("OPTIMIZE_MAX_CONCURRENT", "1");
      try {
        const statuses = (await Promise.all([heavy(), heavy()])).map((r) => r.status).sort();
        expect(statuses).toEqual([200, 503]);
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});
