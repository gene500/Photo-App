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
    expect(q).toContain('nwr["amenity"="parking"]');
    // Only documented output forms: geometry for the trail set, centre for the parking set (never both on one statement).
    expect(q).toContain(")->.t;.t out tags geom qt;");
    expect(q).toContain('nwr["amenity"="parking"]');
    expect(q).toContain("->.p;.p out tags center qt;");
    expect(q).not.toContain("geom center");
    expect(q.match(/\bout\b/g)).toHaveLength(3); // [out:json] plus the two out statements
    expect(q.indexOf('nwr["amenity"="parking"]')).toBeGreaterThan(q.indexOf(".t out tags geom qt;"));
    expect(q).toContain("[maxsize:6000000]");
  });
  it("keeps the box inside lat +-90 and lng +-180 (clamped, not wrapped) at the poles and the antimeridian", () => {
    const nums = (q: string) => q.match(/\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)/)!.slice(1).map(Number);
    for (const [lat, lng] of [[89.999, 0], [-89.999, 10], [10, 179.999], [10, -179.999], [89.999, 179.999], [90, 180], [-90, -180]]) {
      const [s, w, n, e] = nums(osmHikeQuery(lat, lng, 2500));
      expect(s).toBeGreaterThanOrEqual(-90);
      expect(n).toBeLessThanOrEqual(90);
      expect(w).toBeGreaterThanOrEqual(-180);
      expect(e).toBeLessThanOrEqual(180);
      expect(s).toBeLessThanOrEqual(n);
      expect(w).toBeLessThanOrEqual(e);
    }
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
    expect(r.trailheads[1].point).toEqual([-109.5204364, 38.7356924]);
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
    expect(r).toEqual({ segments: [], trailheads: [{ point: [2, 1], name: null }], parking: [{ point: [4, 3], name: null }] });
  });
  it("reads parking drawn as an area (way or relation) by its centre, with the OSM name", () => {
    const r = parseOsm({ elements: [
      { type: "way", tags: { amenity: "parking", name: "Arch lot" }, center: { lat: 1, lon: 2 }, geometry: [{ lat: 1, lon: 2 }, { lat: 1, lon: 2.001 }] },
      { type: "relation", tags: { amenity: "parking" }, center: { lat: 5, lon: 6 } },
      { type: "node", lat: 7, lon: 8, tags: { amenity: "parking", name: "  Node lot " } },
    ] })!;
    expect(r.parking).toEqual([
      { point: [2, 1], name: "Arch lot" }, { point: [6, 5], name: null }, { point: [8, 7], name: "Node lot" },
    ]);
    expect(r.segments).toEqual([]);
  });
  it("reads a parking node whose point comes as lat/lon or as center", () => {
    const r = parseOsm({ elements: [
      { type: "node", lat: 1, lon: 2, tags: { amenity: "parking", name: "A" } },
      { type: "node", center: { lat: 3, lon: 4 }, tags: { amenity: "parking", name: "B" } },
    ] })!;
    expect(r.parking).toEqual([{ point: [2, 1], name: "A" }, { point: [4, 3], name: "B" }]);
  });
  it("skips parking without a centre and private or no-access parking", () => {
    const r = parseOsm({ elements: [
      { type: "way", tags: { amenity: "parking" }, geometry: [{ lat: 1, lon: 2 }, { lat: 1, lon: 2.001 }] },
      { type: "way", tags: { amenity: "parking", access: "private" }, center: { lat: 1, lon: 2 } },
      { type: "node", lat: 3, lon: 4, tags: { amenity: "parking", access: "no" } },
    ] })!;
    expect(r.parking).toEqual([]);
  });
  it("cuts a parking name to 120 characters and gives null for a blank name", () => {
    const r = parseOsm({ elements: [
      { type: "node", lat: 1, lon: 2, tags: { amenity: "parking", name: "x".repeat(200) } },
      { type: "node", lat: 3, lon: 4, tags: { amenity: "parking", name: "   " } },
    ] })!;
    expect(r.parking[0].name).toHaveLength(120);
    expect(r.parking[1].name).toBeNull();
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
  it("a too-heavy answer from two mirrors (dense city) is an empty finished result after TWO queries, not a failure", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ elements: [], remark: "runtime error: Query ran out of memory in \"query\" at line 5 using about 2048 MB of RAM." })));
    expect(await fetchOsmTrails(40.7, -74, 2500, f as unknown as typeof fetch)).toEqual({ segments: [], trailheads: [], parking: [] });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("a too-heavy first mirror and a failing second mirror is a failure (null), so the lookup is retried later", async () => {
    let n = 0;
    const f = vi.fn(async () => {
      if (n++ === 0) return new Response(JSON.stringify({ elements: [], remark: "runtime error: Query ran out of memory in \"query\"" }));
      throw new Error("network");
    });
    expect(await fetchOsmTrails(40.7, -74, 2500, f as unknown as typeof fetch)).toBeNull();
  });
  it("keeps only lots and trailheads within the radius of the stop (a true circle, not the box corners)", async () => {
    const lat = 40;
    const lng = -105;
    const dLat = (m: number) => m / 111_320;
    const dLng = (m: number) => m / (111_320 * Math.cos((lat * Math.PI) / 180));
    const near = { type: "node", lat: lat + dLat(2000), lon: lng, tags: { amenity: "parking", name: "near" } };
    const corner = { type: "node", lat: lat + dLat(2121), lon: lng + dLng(2121), tags: { amenity: "parking", name: "corner" } }; // 3 km diagonal
    const trailCorner = { type: "node", lat: lat + dLat(2121), lon: lng + dLng(2121), tags: { highway: "trailhead", name: "th" } };
    const trailNear = { type: "node", lat, lon: lng + dLng(2400), tags: { highway: "trailhead", name: "th2" } };
    const f = vi.fn(async () => new Response(JSON.stringify({ elements: [near, corner, trailCorner, trailNear] })));
    const r = await fetchOsmTrails(lat, lng, 2500, f as unknown as typeof fetch);
    expect(r!.parking.map((l) => l.name)).toEqual(["near"]);
    expect(r!.trailheads.map((l) => l.name)).toEqual(["th2"]);
  });
  it("is null when Overpass fails", async () => {
    const f = vi.fn(async () => new Response("no", { status: 400 }));
    expect(await fetchOsmTrails(1, 2, 3000, f as unknown as typeof fetch)).toBeNull();
  });
});

describe("parking lot filtering and names", () => {
  it("a lot name of only zero-width characters is stored as null", () => {
    const r = parseOsm({ elements: [{ type: "node", lat: 1, lon: 2, tags: { amenity: "parking", name: "\u200B\u200D" } }] });
    expect(r!.parking).toEqual([{ point: [2, 1], name: null }]);
  });
  const lot = (tags: Record<string, string>) => ({ type: "node", lat: 1, lon: 2, tags: { amenity: "parking", ...tags } });
  it.each([["access", "private"], ["access", "no"], ["access", "customers"], ["access", "permit"], ["parking", "street_side"], ["parking", "lane"], ["parking", "underground"]])(
    "skips parking with %s=%s",
    (k, v) => {
      expect(parseOsm({ elements: [lot({ [k]: v })] })!.parking).toEqual([]);
    },
  );
  it("keeps ordinary lots (surface, no access tag, access=yes)", () => {
    expect(parseOsm({ elements: [lot({ parking: "surface" }), lot({ access: "yes" }), lot({})] })!.parking).toHaveLength(3);
  });
  it("cleans lot names: control and bidi characters removed, emoji not split at 120", () => {
    const r = parseOsm({ elements: [lot({ name: "No\u0000rth\u202E lot" }), lot({ name: "x".repeat(119) + "\u{1F600}" }), lot({ name: "y".repeat(118) + "\u{1F600}z" })] })!;
    expect(r.parking[0].name).toBe("North lot");
    expect(r.parking[1].name).toBe("x".repeat(119));
    expect(r.parking[2].name).toBe("y".repeat(118) + "\u{1F600}");
  });
  it("cleans trailhead names the same way", () => {
    const r = parseOsm({ elements: [{ type: "node", lat: 1, lon: 2, tags: { highway: "trailhead", name: "T\u0000H\u202E" } }] })!;
    expect(r.trailheads[0].name).toBe("TH");
  });
});
