import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/overpass-arches-road-end.json";
import { serializeAccessTrail } from "@/lib/access-trail";
import { hikeKey } from "@/lib/hike";
import { FAKE_ROAD_END_POINT } from "@/server/external/fake";
import { OverpassTooHeavyError } from "@/server/suggestions/overpass";
import { createRoadEndLookup, lookupRoadEnd, ROAD_END_FAILURE_TTL_MS, ROAD_END_NONE_TTL_MS, ROAD_END_TTL_MS } from "./road-end-lookup";

const STOP = { lat: 38.7436, lng: -109.4993 };
const json = (b: unknown) => new Response(JSON.stringify(b));
const fetchOf = (body: unknown = fixture) => vi.fn(async () => json(body)) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
const clock = () => {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};
/** A road 300 m south of the stop, plus (optionally) a wiggly trail from the road to the stop. */
function synthetic(points: number, wiggle = 0.0004) {
  const g = (lat: number, lon: number) => ({ lat, lon });
  const road = { type: "way", tags: { highway: "secondary" }, geometry: [g(STOP.lat - 0.0027, STOP.lng - 0.01), g(STOP.lat - 0.0027, STOP.lng + 0.01)] };
  const trail = {
    type: "way",
    tags: { highway: "path" },
    geometry: Array.from({ length: points }, (_, i) => g(STOP.lat - 0.0027 + (0.0027 * i) / (points - 1), STOP.lng + (i % 2 ? wiggle : -wiggle) * (i === points - 1 ? 0 : 1))),
  };
  return { elements: [road, trail] };
}

afterEach(() => {
  delete process.env.EXTERNAL_APIS_FAKE;
  vi.useRealTimers();
});

describe("constants", () => {
  it("has the TTLs", () => {
    expect(ROAD_END_TTL_MS).toBe(24 * 3600_000);
    expect(ROAD_END_NONE_TTL_MS).toBe(3600_000);
    expect(ROAD_END_FAILURE_TTL_MS).toBe(300_000);
    expect(typeof lookupRoadEnd).toBe("function");
  });
});

describe("createRoadEndLookup", () => {
  it("answers the Arches fixture with a road end and a capped, serializable trail", async () => {
    const { result, failed } = await createRoadEndLookup({ fetchImpl: fetchOf() })(STOP.lat, STOP.lng);
    expect(failed).toBe(false);
    expect(result?.kind).toBe("road-end");
    if (result?.kind !== "road-end") return;
    expect(result.trail).not.toBeNull();
    expect(result.trail!.length).toBeLessThanOrEqual(120);
    expect(serializeAccessTrail(result.trail)).not.toBeNull();
  });

  it("sends the user agent and queries the snapped point", async () => {
    const f = fetchOf();
    await createRoadEndLookup({ fetchImpl: f })(38.74361234, -109.49931234);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("overpass");
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe("road-trip-photo-planner/0.1");
    const [qLat, qLng] = hikeKey(38.74361234, -109.49931234).split(",").map(Number);
    const q = new URLSearchParams(String(init.body)).get("data")!;
    const m = q.match(/\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\)/)!;
    expect((Number(m[1]) + Number(m[3])) / 2).toBeCloseTo(qLat, 4);
    expect((Number(m[2]) + Number(m[4])) / 2).toBeCloseTo(qLng, 4);
  });

  describe("failures", () => {
    it("every mirror rejecting is failed, never none", { timeout: 15_000 }, async () => {
      const f = vi.fn(async () => { throw new Error("down"); }) as unknown as typeof fetch;
      expect(await createRoadEndLookup({ fetchImpl: f })(STOP.lat, STOP.lng)).toEqual({ result: null, failed: true });
    });
    it("HTTP 500 is failed", { timeout: 15_000 }, async () => {
      const f = vi.fn(async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
      expect(await createRoadEndLookup({ fetchImpl: f })(STOP.lat, STOP.lng)).toEqual({ result: null, failed: true });
    });
    it("an answer with no elements is failed", { timeout: 15_000 }, async () => {
      expect(await createRoadEndLookup({ fetchImpl: fetchOf({ version: 0.6 }) })(STOP.lat, STOP.lng)).toEqual({ result: null, failed: true });
    });
    it("a too-heavy query is failed", { timeout: 15_000 }, async () => {
      const f = vi.fn(async () => json({ remark: "runtime error: Query run out of memory", elements: [] })) as unknown as typeof fetch;
      expect(await createRoadEndLookup({ fetchImpl: f })(STOP.lat, STOP.lng)).toEqual({ result: null, failed: true });
      expect(OverpassTooHeavyError).toBeDefined();
    });
    it("is remembered 5 minutes, then retried", { timeout: 15_000 }, async () => {
      const c = clock();
      let ok = false;
      const f = vi.fn(async () => {
        if (!ok) throw new Error("down");
        return json(fixture);
      }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
      const lookup = createRoadEndLookup({ fetchImpl: f, now: c.now });
      expect((await lookup(STOP.lat, STOP.lng)).failed).toBe(true);
      const calls = f.mock.calls.length;
      c.advance(ROAD_END_FAILURE_TTL_MS - 1);
      expect((await lookup(STOP.lat, STOP.lng)).failed).toBe(true);
      expect(f.mock.calls.length).toBe(calls);
      ok = true;
      c.advance(2);
      const r = await lookup(STOP.lat, STOP.lng);
      expect(r.failed).toBe(false);
      expect(r.result?.kind).toBe("road-end");
    });
  });

  describe("caching", () => {
    it("keeps a road end 24 h", async () => {
      const c = clock();
      const f = fetchOf();
      const lookup = createRoadEndLookup({ fetchImpl: f, now: c.now });
      await lookup(STOP.lat, STOP.lng);
      c.advance(ROAD_END_TTL_MS - 1);
      await lookup(STOP.lat, STOP.lng);
      expect(f).toHaveBeenCalledTimes(1);
      c.advance(2);
      await lookup(STOP.lat, STOP.lng);
      expect(f).toHaveBeenCalledTimes(2);
    });
    it("keeps none and near-road 1 h", async () => {
      for (const [body, kind] of [[{ elements: [] }, "none"], [{ elements: [{ type: "way", tags: { highway: "secondary" }, geometry: [{ lat: STOP.lat - 0.0003, lon: STOP.lng - 0.01 }, { lat: STOP.lat - 0.0003, lon: STOP.lng + 0.01 }] }] }, "near-road"]] as const) {
        const c = clock();
        const f = fetchOf(body);
        const lookup = createRoadEndLookup({ fetchImpl: f, now: c.now });
        expect((await lookup(STOP.lat, STOP.lng)).result).toEqual({ kind });
        c.advance(ROAD_END_NONE_TTL_MS - 1);
        await lookup(STOP.lat, STOP.lng);
        expect(f).toHaveBeenCalledTimes(1);
        c.advance(2);
        await lookup(STOP.lat, STOP.lng);
        expect(f).toHaveBeenCalledTimes(2);
      }
    });
    it("shares one fetch between concurrent calls", async () => {
      const f = fetchOf();
      const lookup = createRoadEndLookup({ fetchImpl: f });
      const [a, b] = await Promise.all([lookup(STOP.lat, STOP.lng), lookup(STOP.lat, STOP.lng)]);
      expect(f).toHaveBeenCalledTimes(1);
      expect(a).toEqual(b);
    });
  });

  describe("trail caps", () => {
    it("simplifies a trail of more than 120 vertices", async () => {
      // Straight-ish zigzag with 1 m-scale wiggles is simplified away; use big wiggles so the cap (not tolerance) matters.
      const { result } = await createRoadEndLookup({ fetchImpl: fetchOf(synthetic(400, 0.00002)) })(STOP.lat, STOP.lng);
      expect(result?.kind).toBe("road-end");
      if (result?.kind !== "road-end") return;
      expect(result.trail).not.toBeNull();
      expect(result.trail!.length).toBeLessThanOrEqual(120);
    });
    it("drops the trail but keeps the road end when it will not fit 4000 chars", async () => {
      // Force the serializer to refuse both the 120 and the 60 point attempts.
      const mod = await import("@/lib/access-trail");
      const spy = vi.spyOn(mod, "serializeAccessTrail").mockReturnValue(null);
      try {
        const { result } = await createRoadEndLookup({ fetchImpl: fetchOf(synthetic(40, 0.0006)) })(STOP.lat, STOP.lng);
        expect(result?.kind).toBe("road-end");
        if (result?.kind !== "road-end") return;
        expect(result.trail).toBeNull();
        expect(result.point).toHaveLength(2);
        expect(spy).toHaveBeenCalledTimes(2);
      } finally {
        spy.mockRestore();
      }
    });
  });

  it("answers from the fake with no fetch when FAKE_EXTERNAL is on", async () => {
    process.env.EXTERNAL_APIS_FAKE = "1";
    const f = fetchOf();
    const r = await createRoadEndLookup({ fetchImpl: f })(FAKE_ROAD_END_POINT.lat + 0.01, FAKE_ROAD_END_POINT.lng);
    expect(r.failed).toBe(false);
    expect(r.result?.kind).toBe("road-end");
    expect(f).not.toHaveBeenCalled();
    expect(await createRoadEndLookup({ fetchImpl: f })(10, 10)).toEqual({ result: { kind: "none" }, failed: false });
  });
});
