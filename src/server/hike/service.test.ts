import { afterEach, describe, expect, it, vi } from "vitest";
import nps from "./fixtures/nps-delicate-arch.json";
import osm from "./fixtures/osm-delicate-arch.json";
import { createHikeLookup, HIKE_CACHE_MAX, LOT_MAX_WALK_M, HIKE_FAILURE_TTL_MS, HIKE_NONE_TTL_MS, HIKE_TTL_MS, lookupHike } from "./service";

const ARCH = { lat: 38.7436, lng: -109.4993 };
const VIEWPOINT = { lat: 38.73787, lng: -109.49995 };
// A synthetic trail 0.01 deg of longitude (about 870 m) long, ending at the place; `at` fractions give points along it.
const trailTo = (p: { lat: number; lng: number }) => ({ type: "way", tags: { highway: "path" }, geometry: [{ lat: p.lat, lon: p.lng - 0.01 }, { lat: p.lat, lon: p.lng - 0.005 }, { lat: p.lat, lon: p.lng }] });
const parkingAt = (lat: number, lon: number, name?: string) => ({ type: "node", lat, lon, tags: { amenity: "parking", ...(name ? { name } : {}) } });
const json = (b: unknown) => new Response(JSON.stringify(b));
/** NPS and Overpass answers by host; either can be replaced to simulate an outage or an empty park. */
function net(opts: { nps?: () => Response; osm?: () => Response } = {}) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("mapservices.nps.gov")) return (opts.nps ?? (() => json(nps)))();
    return (opts.osm ?? (() => json(osm)))();
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

afterEach(() => {
  delete process.env.EXTERNAL_APIS_FAKE;
});

describe("lookupHike", () => {
  it("uses National Park Service trails when OpenStreetMap has no lot or trailhead walk to the place (access null)", async () => {
    const f = net({ osm: () => json({ elements: [] }) });
    const { hike } = await lookupHike(VIEWPOINT.lat, VIEWPOINT.lng, f);
    expect(hike).toMatchObject({ source: "nps", attribution: "Trail data: National Park Service", access: null });
    expect(hike!.distanceMeters).toBeGreaterThan(300);
    expect(hike!.geometry.length).toBeLessThanOrEqual(200);
  });

  it("tries OpenStreetMap first: a lot walk wins over NPS trails, and NPS is not asked", async () => {
    const f = net({ osm: () => json({ elements: [trailTo(VIEWPOINT), parkingAt(VIEWPOINT.lat, VIEWPOINT.lng - 0.01, "Arch lot")] }) });
    const { hike, failed } = await lookupHike(VIEWPOINT.lat, VIEWPOINT.lng, f);
    expect(failed).toBe(false);
    expect(hike?.source).toBe("osm");
    expect(hike?.access).toEqual({ lat: VIEWPOINT.lat, lng: VIEWPOINT.lng - 0.01, name: "Arch lot" });
    expect(f.mock.calls.every(([u]) => !String(u).includes("nps.gov"))).toBe(true);
  });

  it("gives the lot's own coordinates and a null name when the lot is unnamed", async () => {
    const f = net({ osm: () => json({ elements: [trailTo(ARCH), parkingAt(ARCH.lat + 0.0001, ARCH.lng - 0.01)] }) });
    const { hike } = await lookupHike(ARCH.lat, ARCH.lng, f);
    expect(hike?.access).toEqual({ lat: ARCH.lat + 0.0001, lng: ARCH.lng - 0.01, name: null });
  });

  it("starts at the lot even when a trailhead marker is nearer, and falls back to a trailhead when there is no lot", async () => {
    const head = { type: "node", lat: ARCH.lat, lon: ARCH.lng - 0.002, tags: { highway: "trailhead", name: "Arch trailhead" } };
    const both = await lookupHike(ARCH.lat, ARCH.lng, net({ osm: () => json({ elements: [trailTo(ARCH), head, parkingAt(ARCH.lat, ARCH.lng - 0.01, "Far lot")] }) }));
    expect(both.hike?.access?.name).toBe("Far lot");
    const onlyHead = await lookupHike(ARCH.lat, ARCH.lng, net({ osm: () => json({ elements: [trailTo(ARCH), head] }) }));
    expect(onlyHead.hike?.access).toEqual({ lat: ARCH.lat, lng: ARCH.lng - 0.002, name: "Arch trailhead" });
  });

  // A U-shaped trail `km` long ending at the place: its start is 2 km due west (inside the 2.5 km circle for lots and markers), so a long walk never needs a lot outside the circle.
  const longTrail = (km: number) => {
    const mLat = 111_320;
    const mLng = 111_320 * Math.cos((ARCH.lat * Math.PI) / 180);
    const d = (km * 1000 - 2000) / 2;
    const lot = { lat: ARCH.lat, lon: ARCH.lng - 2000 / mLng };
    const geometry = [lot, { lat: ARCH.lat + d / mLat, lon: lot.lon }, { lat: ARCH.lat + d / mLat, lon: ARCH.lng }, { lat: ARCH.lat, lon: ARCH.lng }];
    // A point on the last leg `m` metres north of the place.
    const onLastLeg = (m: number) => ({ lat: ARCH.lat + m / mLat, lon: ARCH.lng });
    return { type: "way", tags: { highway: "path" }, geometry, lot, onLastLeg };
  };
  const headAt = (p: { lat: number; lon: number }) => ({ type: "node", lat: p.lat, lon: p.lon, tags: { highway: "trailhead", name: "Near head" } });

  it("exports the lot walking cap as 5000 m", () => {
    expect(LOT_MAX_WALK_M).toBe(5000);
  });

  it("skips a lot 6 km of trail away and uses a nearer trailhead marker", async () => {
    const t = longTrail(6);
    const near = t.onLastLeg(1500);
    const f = net({ osm: () => json({ elements: [t, parkingAt(t.lot.lat, t.lot.lon, "Far lot"), headAt(near)] }) });
    const { hike } = await lookupHike(ARCH.lat, ARCH.lng, f);
    expect(hike?.access).toEqual({ lat: near.lat, lng: near.lon, name: "Near head" });
    expect(hike!.distanceMeters).toBeLessThan(2000);
  });

  it("gives access null for a lot 6 km away when there is no trailhead marker (the dead-end walk is still drawn)", async () => {
    const t = longTrail(6);
    const f = net({ nps: () => json({ features: [] }), osm: () => json({ elements: [t, parkingAt(t.lot.lat, t.lot.lon, "Far lot")] }) });
    const { hike } = await lookupHike(ARCH.lat, ARCH.lng, f);
    expect(hike?.source).toBe("osm");
    expect(hike?.access).toBeNull();
  });

  it("still starts at a lot 4 km of trail away", async () => {
    const t = longTrail(4);
    const f = net({ osm: () => json({ elements: [t, parkingAt(t.lot.lat, t.lot.lon, "Lot 4k"), headAt(t.onLastLeg(1000))] }) });
    const { hike } = await lookupHike(ARCH.lat, ARCH.lng, f);
    expect(hike?.access?.name).toBe("Lot 4k");
  });

  it("applies the same 5000 m cap to trailhead markers: one 6 km of trail away is never the drive target", async () => {
    const t = longTrail(6);
    const f = net({ nps: () => json({ features: [] }), osm: () => json({ elements: [t, headAt(t.lot)] }) });
    const { hike } = await lookupHike(ARCH.lat, ARCH.lng, f);
    expect(hike?.source).toBe("osm");
    expect(hike?.access).toBeNull();
    const ok = longTrail(4);
    const g = net({ osm: () => json({ elements: [ok, headAt(ok.lot)] }) });
    expect((await lookupHike(ARCH.lat, ARCH.lng, g)).hike?.access?.name).toBe("Near head");
  });

  it("keeps the hike but gives access null when the lot is within 150 m of the place", async () => {
    // A bent trail: the lot is 130 m from the place in a straight line but the walk to it is about 400 m.
    const lat = ARCH.lat, lng = ARCH.lng;
    const bent = { type: "way", tags: { highway: "path" }, geometry: [{ lat, lon: lng - 0.0012 }, { lat: lat + 0.002, lon: lng - 0.0012 }, { lat: lat + 0.002, lon: lng }, { lat, lon: lng }] };
    const f = net({ osm: () => json({ elements: [bent, parkingAt(lat, lng - 0.0012, "Close lot")] }) });
    const { hike } = await lookupHike(lat, lng, f);
    expect(hike?.source).toBe("osm");
    expect(hike?.access).toBeNull();
    expect(hike!.distanceMeters).toBeGreaterThan(300);
  });

  it("falls back to OpenStreetMap when the park layer has no trail near the place", async () => {
    const { hike } = await lookupHike(ARCH.lat, ARCH.lng, net());
    expect(hike?.source).toBe("osm");
    expect(hike?.attribution).toBe("Trail data © OpenStreetMap contributors");
    expect(hike?.access).toEqual({ lat: 38.7356924, lng: -109.5204364, name: "Delicate Arch Trailhead" }); // the real fixture has trailheads, no lot
    expect(hike!.distanceMeters).toBeGreaterThan(2200);
    expect(hike!.distanceMeters).toBeLessThan(6500);
    expect(hike!.distanceMeters % 10).toBe(0);
    expect(hike!.geometry.length).toBeGreaterThanOrEqual(2);
  });

  it("goes straight to OpenStreetMap outside a park (NPS answers with no features)", async () => {
    const { hike } = await lookupHike(ARCH.lat, ARCH.lng, net({ nps: () => json({ type: "FeatureCollection", features: [] }) }));
    expect(hike?.source).toBe("osm");
  });

  it("does not need NPS when it is down: OpenStreetMap answers", async () => {
    const { hike, failed } = await lookupHike(ARCH.lat, ARCH.lng, net({ nps: () => new Response("x", { status: 500 }) }));
    expect(hike?.source).toBe("osm");
    expect(failed).toBe(false);
  });

  it("returns the NPS hike with access null when OpenStreetMap is down (and counts the lookup as failed)", async () => {
    const { hike, failed } = await lookupHike(VIEWPOINT.lat, VIEWPOINT.lng, net({ osm: () => new Response("x", { status: 400 }) }));
    expect(hike).toMatchObject({ source: "nps", access: null });
    expect(failed).toBe(true);
  });

  it("uses the OpenStreetMap dead-end walk (access null) when there is no lot and NPS has nothing", async () => {
    const f = net({ nps: () => json({ features: [] }), osm: () => json({ elements: [trailTo(ARCH)] }) });
    const { hike } = await lookupHike(ARCH.lat, ARCH.lng, f);
    expect(hike).toMatchObject({ source: "osm", access: null });
    expect(hike!.distanceMeters).toBeGreaterThan(700);
  });

  it("answers no hike (and not failed) when both sources work but have no trail", async () => {
    const empty = { elements: [] };
    const r = await lookupHike(10, 10, net({ nps: () => json({ features: [] }), osm: () => json(empty) }));
    expect(r).toEqual({ hike: null, failed: false });
  });

  it("marks the answer failed when OpenStreetMap is down and nothing else was found", async () => {
    const r = await lookupHike(10, 10, net({ nps: () => json({ features: [] }), osm: () => new Response("x", { status: 400 }) }));
    expect(r).toEqual({ hike: null, failed: true });
  });
});

describe("lookupHike when OpenStreetMap is down but NPS answers", () => {
  it("returns the NPS hike for display with access null and failed true", async () => {
    const r = await lookupHike(VIEWPOINT.lat, VIEWPOINT.lng, net({ osm: () => new Response("x", { status: 400 }) }));
    expect(r.hike).toMatchObject({ source: "nps", access: null });
    expect(r.failed).toBe(true);
  });

  it("caches that answer for the short failure time only", async () => {
    const t = { v: 1_000_000 };
    const f = net({ osm: () => new Response("x", { status: 400 }) });
    const get = createHikeLookup({ fetchImpl: f, now: () => t.v });
    expect((await get.status(VIEWPOINT.lat, VIEWPOINT.lng)).failed).toBe(true);
    const calls = f.mock.calls.length;
    t.v += HIKE_FAILURE_TTL_MS - 1;
    await get.status(VIEWPOINT.lat, VIEWPOINT.lng);
    expect(f.mock.calls.length).toBe(calls);
    t.v += 2;
    await get.status(VIEWPOINT.lat, VIEWPOINT.lng);
    expect(f.mock.calls.length).toBeGreaterThan(calls);
  });
});

describe("lookupHike on a dense city (Overpass too heavy)", () => {
  const heavy = () => json({ elements: [], remark: "runtime error: Query ran out of memory in \"query\" at line 5 using about 2048 MB of RAM." });
  it("is a finished no-lot answer after two Overpass queries (two mirrors both heavy), cached like 'no hike', while a network failure stays failed", async () => {
    const f = net({ nps: () => json({ features: [] }), osm: heavy });
    const t = { v: 1_000_000 };
    const get = createHikeLookup({ fetchImpl: f, now: () => t.v });
    expect(await get.status(40.7, -74)).toEqual({ hike: null, failed: false });
    const osmCalls = f.mock.calls.filter(([u]) => !String(u).includes("nps.gov")).length;
    expect(osmCalls).toBe(2);
    const n = f.mock.calls.length;
    t.v += HIKE_NONE_TTL_MS - 1;
    await get.status(40.7, -74);
    expect(f.mock.calls.length).toBe(n);
    const down = net({ nps: () => json({ features: [] }), osm: () => { throw new Error("network"); } });
    expect((await lookupHike(40.7, -74, down)).failed).toBe(true);
  });
});

describe("createHikeLookup", () => {
  const clock = () => {
    let t = 1_000_000;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  };

  it("caches a hike for 24 hours on a 4-decimal grid", async () => {
    const f = net();
    const c = clock();
    const get = createHikeLookup({ fetchImpl: f, now: c.now });
    const a = await get(ARCH.lat, ARCH.lng);
    const calls = f.mock.calls.length;
    expect(await get(ARCH.lat + 0.00001, ARCH.lng)).toEqual(a);
    expect(f.mock.calls.length).toBe(calls);
    c.advance(HIKE_TTL_MS - 1);
    await get(ARCH.lat, ARCH.lng);
    expect(f.mock.calls.length).toBe(calls);
    c.advance(2);
    await get(ARCH.lat, ARCH.lng);
    expect(f.mock.calls.length).toBeGreaterThan(calls);
  });

  it("remembers 'no hike' for an hour and a failure for five minutes", async () => {
    const c = clock();
    const none = net({ nps: () => json({ features: [] }), osm: () => json({ elements: [] }) });
    const getNone = createHikeLookup({ fetchImpl: none, now: c.now });
    expect(await getNone(10, 10)).toBeNull();
    const n = none.mock.calls.length;
    c.advance(HIKE_NONE_TTL_MS - 1);
    await getNone(10, 10);
    expect(none.mock.calls.length).toBe(n);
    c.advance(2);
    await getNone(10, 10);
    expect(none.mock.calls.length).toBeGreaterThan(n);

    const down = net({ nps: () => new Response("x", { status: 500 }), osm: () => new Response("x", { status: 400 }) });
    const getDown = createHikeLookup({ fetchImpl: down, now: c.now });
    await getDown(20, 20);
    const d = down.mock.calls.length;
    c.advance(HIKE_FAILURE_TTL_MS - 1);
    await getDown(20, 20);
    expect(down.mock.calls.length).toBe(d);
    c.advance(2);
    await getDown(20, 20);
    expect(down.mock.calls.length).toBeGreaterThan(d);
  });

  it("shares one in-flight lookup between concurrent callers", async () => {
    const f = net();
    const get = createHikeLookup({ fetchImpl: f });
    await Promise.all([get(ARCH.lat, ARCH.lng), get(ARCH.lat, ARCH.lng)]);
    const first = f.mock.calls.length;
    const f2 = net();
    const get2 = createHikeLookup({ fetchImpl: f2 });
    await get2(ARCH.lat, ARCH.lng);
    expect(first).toBe(f2.mock.calls.length);
  });

  it("is bounded", async () => {
    expect(HIKE_CACHE_MAX).toBeLessThanOrEqual(1000);
    const f = net({ nps: () => json({ features: [] }), osm: () => json({ elements: [] }) });
    const get = createHikeLookup({ fetchImpl: f });
    for (let i = 0; i < HIKE_CACHE_MAX + 5; i++) await get(10 + i / 1000, 10);
    const before = f.mock.calls.length;
    await get(10, 10); // the oldest was evicted
    expect(f.mock.calls.length).toBeGreaterThan(before);
  });

  it("never throws", async () => {
    const get = createHikeLookup({ fetchImpl: vi.fn().mockRejectedValue(new Error("boom")) });
    expect(await get(10, 10)).toBeNull();
  });

  it("in fake mode answers a canned hike near the fake point, null elsewhere, and never calls the network", async () => {
    process.env.EXTERNAL_APIS_FAKE = "1";
    const f = net();
    const get = createHikeLookup({ fetchImpl: f });
    const near = await get(37.01, -119.49);
    expect(near?.distanceMeters).toBeGreaterThan(1800);
    expect(await get(36.2, -120.5)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("status tells 'no hike' from 'service down' and shares the cache with get", async () => {
    const none = net({ nps: () => json({ features: [] }), osm: () => json({ elements: [] }) });
    const a = createHikeLookup({ fetchImpl: none });
    expect(await a.status(10, 10)).toEqual({ hike: null, failed: false });
    const n = none.mock.calls.length;
    expect(await a(10, 10)).toBeNull();
    expect(none.mock.calls.length).toBe(n);

    const down = net({ nps: () => new Response("x", { status: 500 }), osm: () => new Response("x", { status: 400 }) });
    const b = createHikeLookup({ fetchImpl: down });
    expect(await b.status(20, 20)).toEqual({ hike: null, failed: true });
    expect(await b.status(20, 20)).toEqual({ hike: null, failed: true });

    const ok = createHikeLookup({ fetchImpl: net() });
    const s = await ok.status(ARCH.lat, ARCH.lng);
    expect(s.failed).toBe(false);
    expect(s.hike).toEqual(await ok(ARCH.lat, ARCH.lng));
  });

  it("status in fake mode returns the fake hike with failed false", async () => {
    process.env.EXTERNAL_APIS_FAKE = "1";
    const f = net();
    const get = createHikeLookup({ fetchImpl: f });
    expect(await get.status(37.01, -119.49)).toEqual({ hike: await get(37.01, -119.49), failed: false });
    expect(await get.status(36.2, -120.5)).toEqual({ hike: null, failed: false });
    expect(f).not.toHaveBeenCalled();
  });
});
