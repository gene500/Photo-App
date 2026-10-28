import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/osm-delicate-arch.json";
import { fetchOsmTrails, OSM_DEADLINE_MS, osmHikeQuery, parseOsm } from "./osm";

const way = (tags: Record<string, string>) => ({ type: "way", tags, geometry: [{ lat: 1, lon: 2 }, { lat: 1.001, lon: 2 }] });

describe("osmHikeQuery", () => {
  it("looks for walkable ways, hiking-route ways, trailheads and parking in a box around the point", () => {
    const q = osmHikeQuery(38.7436, -109.4993, 2500);
    expect(q).toContain('way["highway"~"^(path|footway|track|steps|bridleway)$"]["footway"!~"^(sidewalk|crossing)$"](38.721');
    expect(q).toContain('rel["route"="hiking"](38.721');
    expect(q).toContain("->.h;way(r.h)");
    expect(q).toContain('node["highway"="trailhead"]');
    expect(q).toContain('node["amenity"="parking"]');
    expect(q).toContain("out tags geom");
    expect(q).toContain("[maxsize:6000000]");
  });
  it("makes the box about 2 x radius wide in metres, wider in degrees of longitude at high latitude", () => {
    const m = osmHikeQuery(0, 0, 1000).match(/\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)/)!.slice(1).map(Number);
    expect(m[2] - m[0]).toBeCloseTo(2000 / 111_320, 4);
    const n = osmHikeQuery(60, 10, 1000).match(/\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)/)!.slice(1).map(Number);
    expect((n[3] - n[1]) / (n[2] - n[0])).toBeCloseTo(2, 1);
  });
});

describe("parseOsm", () => {
  it("reads the real Delicate Arch answer: walkable ways and the two trailheads", () => {
    const r = parseOsm(fixture)!;
    expect(r.trailheads).toHaveLength(2);
    expect(r.parking).toEqual([]);
    // 20 ways in the answer; 2 are roads named "...Road" tracks, the crossing footways are dropped.
    expect(r.segments.length).toBe(15);
    expect(r.trailheads[1]).toEqual([-109.5204364, 38.7356924]);
  });
  it("drops private, no-foot, sidewalk, crossing and road-like track ways", () => {
    const els = [
      way({ highway: "path" }), way({ highway: "path", access: "private" }), way({ highway: "path", foot: "no" }),
      way({ highway: "footway", footway: "sidewalk" }), way({ highway: "footway", footway: "crossing" }),
      way({ highway: "track", name: "Cache Valley Road" }), way({ highway: "track", name: "Ridge Trail" }), way({ highway: "residential" }),
    ];
    expect(parseOsm({ elements: els })!.segments).toHaveLength(2);
  });
  it("collects trailhead and parking nodes and skips malformed elements", () => {
    const r = parseOsm({ elements: [
      { type: "node", lat: 1, lon: 2, tags: { highway: "trailhead" } }, { type: "node", lat: 3, lon: 4, tags: { amenity: "parking" } },
      { type: "node", tags: { highway: "trailhead" } }, null, { type: "way", tags: { highway: "path" } },
      { type: "way", tags: { highway: "path" }, geometry: [{ lat: 1, lon: 2 }] },
    ] })!;
    expect(r).toEqual({ segments: [], trailheads: [[2, 1]], parking: [[4, 3]] });
  });
  it("is null when the answer is not an element list", () => {
    expect(parseOsm(null)).toBeNull();
    expect(parseOsm({ elements: "x" })).toBeNull();
  });
});

describe("fetchOsmTrails", () => {
  it("posts the query to Overpass and parses the answer", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(fixture)));
    const r = await fetchOsmTrails(38.7436, -109.4993, 3000, f as unknown as typeof fetch);
    expect(r?.trailheads).toHaveLength(2);
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("trailhead");
  });
  it("gives up after the overall deadline even if Overpass never answers", async () => {
    vi.useFakeTimers();
    try {
      const f = vi.fn(() => new Promise<Response>(() => {}));
      const p = fetchOsmTrails(1, 2, 3000, f as unknown as typeof fetch);
      await vi.advanceTimersByTimeAsync(OSM_DEADLINE_MS + 10);
      expect(await p).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it("is null when Overpass fails", async () => {
    const f = vi.fn(async () => new Response("no", { status: 400 }));
    expect(await fetchOsmTrails(1, 2, 3000, f as unknown as typeof fetch)).toBeNull();
  });
});
