import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlacePhoto } from "@/lib/types";
import { createPlacePhotoLookup, getPlacePhoto, PHOTO_CACHE_MAX, PHOTO_HIT_TTL_MS, PHOTO_MISS_TTL_MS, photoCacheKey, PHOTO_PROVIDERS } from "./place-photo";

const photo = (credit: string): PlacePhoto => ({ url: "https://upload.wikimedia.org/a.jpg", title: "T", pageUrl: "https://commons.wikimedia.org/wiki/File:T.jpg", credit });
const place = { name: "Half Dome", lat: 37.7459, lng: -119.5332 };

describe("provider pipeline", () => {
  it("tries providers in order and the first hit wins", async () => {
    const a = vi.fn(async () => null);
    const b = vi.fn(async () => photo("b"));
    const c = vi.fn(async () => photo("c"));
    const lookup = createPlacePhotoLookup({ providers: [a, b, c] });
    expect((await lookup(place))?.credit).toBe("b");
    expect(c).not.toHaveBeenCalled();
  });

  it("falls through providers that return null or throw", async () => {
    const lookup = createPlacePhotoLookup({ providers: [vi.fn(async () => null), vi.fn().mockRejectedValue(new Error("boom")), vi.fn(async () => photo("last"))] });
    expect((await lookup(place))?.credit).toBe("last");
    expect(await createPlacePhotoLookup({ providers: [vi.fn(async () => null)] })(place)).toBeNull();
  });

  it("is Flickr, then Commons, then Wikipedia", () => {
    expect(PHOTO_PROVIDERS.map((p) => p.name)).toEqual(["getFlickrPhoto", "getCommonsPhoto", "getWikipediaPhoto"]);
  });

  it("without a Flickr key goes straight to Commons (no api.flickr.com request)", async () => {
    delete process.env.FLICKR_API_KEY;
    const urls: string[] = [];
    const f = vi.fn(async (u: string | URL | Request) => {
      urls.push(String(u));
      return new Response(JSON.stringify({ batchcomplete: "", query: { pages: {} } }));
    });
    await createPlacePhotoLookup({ fetchImpl: f as unknown as typeof fetch })(place);
    expect(urls.some((u) => u.includes("flickr.com"))).toBe(false);
    expect(urls[0]).toContain("commons.wikimedia.org");
    expect(urls.some((u) => u.includes("en.wikipedia.org"))).toBe(true);
  });
});

describe("server cache", () => {
  it("key rounds to 4 dp and normalises the name", () => {
    expect(photoCacheKey({ name: "  Half   DOME ", lat: 37.74591, lng: -119.53324 })).toBe(photoCacheKey({ name: "half dome", lat: 37.74594, lng: -119.53318 }));
    expect(photoCacheKey({ name: "a", lat: 1, lng: 2 })).not.toBe(photoCacheKey({ name: "b", lat: 1, lng: 2 }));
  });

  it("caches hits for 6 h and misses for 15 min", async () => {
    let t = 0;
    const p = vi.fn(async () => photo("x"));
    const hits = createPlacePhotoLookup({ providers: [p], now: () => t });
    await hits(place);
    await hits(place);
    expect(p).toHaveBeenCalledTimes(1);
    t = PHOTO_HIT_TTL_MS - 1;
    await hits(place);
    expect(p).toHaveBeenCalledTimes(1);
    t = PHOTO_HIT_TTL_MS + 1;
    await hits(place);
    expect(p).toHaveBeenCalledTimes(2);

    t = 0;
    const m = vi.fn(async () => null);
    const misses = createPlacePhotoLookup({ providers: [m], now: () => t });
    await misses(place);
    t = PHOTO_MISS_TTL_MS - 1;
    await misses(place);
    expect(m).toHaveBeenCalledTimes(1);
    t = PHOTO_MISS_TTL_MS + 1;
    await misses(place);
    expect(m).toHaveBeenCalledTimes(2);
  });

  it("evicts the least recently used entry beyond 500", async () => {
    const p = vi.fn(async () => photo("x"));
    const lookup = createPlacePhotoLookup({ providers: [p] });
    for (let i = 0; i < PHOTO_CACHE_MAX; i++) await lookup({ name: "n", lat: i / 100, lng: 0 });
    expect(lookup.size()).toBe(PHOTO_CACHE_MAX);
    await lookup({ name: "n", lat: 0, lng: 0 }); // touch the oldest
    await lookup({ name: "n", lat: 50, lng: 0 }); // pushes out lat 0.01, not lat 0
    expect(lookup.size()).toBe(PHOTO_CACHE_MAX);
    p.mockClear();
    await lookup({ name: "n", lat: 0, lng: 0 });
    expect(p).not.toHaveBeenCalled();
    await lookup({ name: "n", lat: 0.01, lng: 0 });
    expect(p).toHaveBeenCalledTimes(1);
  });

  it("de-duplicates concurrent lookups for the same place", async () => {
    let release!: (p: PlacePhoto) => void;
    const p = vi.fn(() => new Promise<PlacePhoto>((r) => (release = r)));
    const lookup = createPlacePhotoLookup({ providers: [p] });
    const both = Promise.all([lookup(place), lookup({ ...place, name: "half dome" })]);
    await Promise.resolve();
    release(photo("once"));
    const [a, b] = await both;
    expect(a).toBe(b);
    expect(p).toHaveBeenCalledTimes(1);
  });
});

describe("getPlacePhoto in fake mode", () => {
  afterEach(() => {
    delete process.env.EXTERNAL_APIS_FAKE;
  });
  it("returns an inline placeholder without touching the network", async () => {
    process.env.EXTERNAL_APIS_FAKE = "1";
    const spy = vi.spyOn(globalThis, "fetch");
    const p = await getPlacePhoto({ name: "Fake Peak", lat: 1, lng: 2 });
    expect(p?.url.startsWith("data:image/svg+xml,")).toBe(true);
    expect(p?.credit).toBe("Photo: Wikipedia");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
