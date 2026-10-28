import { afterEach, describe, expect, it, vi } from "vitest";
import nps from "./fixtures/nps-delicate-arch.json";
import osm from "./fixtures/osm-delicate-arch.json";
import { createHikeLookup, HIKE_CACHE_MAX, HIKE_FAILURE_TTL_MS, HIKE_NONE_TTL_MS, HIKE_TTL_MS, lookupHike } from "./service";

const ARCH = { lat: 38.7436, lng: -109.4993 };
const VIEWPOINT = { lat: 38.73787, lng: -109.49995 };
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
  it("uses National Park Service trails when they hold a walk to the place", async () => {
    const f = net();
    const { hike } = await lookupHike(VIEWPOINT.lat, VIEWPOINT.lng, f);
    expect(hike).toMatchObject({ source: "nps", attribution: "Trail data: National Park Service" });
    expect(hike!.distanceMeters).toBeGreaterThan(300);
    expect(hike!.geometry.length).toBeLessThanOrEqual(200);
    expect(f.mock.calls.every(([u]) => String(u).includes("nps.gov"))).toBe(true); // OSM was not needed
  });

  it("falls back to OpenStreetMap when the park layer has no trail near the place", async () => {
    const { hike } = await lookupHike(ARCH.lat, ARCH.lng, net());
    expect(hike?.source).toBe("osm");
    expect(hike?.attribution).toBe("Trail data © OpenStreetMap contributors");
    expect(hike!.distanceMeters).toBeGreaterThan(2200);
    expect(hike!.distanceMeters).toBeLessThan(6500);
    expect(hike!.distanceMeters % 10).toBe(0);
    expect(hike!.geometry.length).toBeGreaterThanOrEqual(2);
  });

  it("goes straight to OpenStreetMap outside a park (NPS answers with no features)", async () => {
    const { hike } = await lookupHike(ARCH.lat, ARCH.lng, net({ nps: () => json({ type: "FeatureCollection", features: [] }) }));
    expect(hike?.source).toBe("osm");
  });

  it("falls back to OpenStreetMap when NPS is down", async () => {
    const { hike, failed } = await lookupHike(ARCH.lat, ARCH.lng, net({ nps: () => new Response("x", { status: 500 }) }));
    expect(hike?.source).toBe("osm");
    expect(failed).toBe(false);
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
});
