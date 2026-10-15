import { describe, expect, it, vi } from "vitest";
import { getWikipediaNotable, NOTABLE_MIN_VIEWS } from "./wikipedia-notability";

const place = { name: "Half Dome", lat: 37.7459, lng: -119.5332 };
const page = (title: string, views: number, over: { lat?: number; lon?: number } = {}) => ({
  title,
  coordinates: [{ lat: over.lat ?? 37.7459, lon: over.lon ?? -119.5332 }],
  pageviews: { "2026-09-01": Math.floor(views / 2), "2026-09-02": Math.ceil(views / 2), "2026-09-03": null },
});
const ok = (...pages: ReturnType<typeof page>[]) => vi.fn(async () => new Response(JSON.stringify({ query: { pages: Object.fromEntries(pages.map((p, i) => [String(i + 1), p])) } })));

describe("getWikipediaNotable", () => {
  it("is true for a name-matching article with enough views", async () => {
    expect(await getWikipediaNotable(place, ok(page("Half Dome", NOTABLE_MIN_VIEWS + 10)))).toBe(true);
  });

  it("is false when the article is barely read", async () => {
    expect(await getWikipediaNotable(place, ok(page("Half Dome", 20)))).toBe(false);
  });

  it("is false when no article is near, or an unrelated article is not very close", async () => {
    expect(await getWikipediaNotable(place, ok())).toBe(false);
    expect(await getWikipediaNotable(place, ok(page("Some Town", 5000, { lat: 37.7468 })))).toBe(false); // ~100+ m away, different name
  });

  it("accepts an unrelated title only when the article is right at the spot", async () => {
    expect(await getWikipediaNotable({ ...place, name: "Viewpoint" }, ok(page("Glacier Point Hut", 5000)))).toBe(true);
  });

  it("is undefined (unknown) on HTTP errors, bad JSON and network failures", async () => {
    expect(await getWikipediaNotable(place, vi.fn(async () => new Response("nope", { status: 503 })))).toBeUndefined();
    expect(await getWikipediaNotable(place, vi.fn(async () => new Response("not json")))).toBeUndefined();
    expect(await getWikipediaNotable(place, vi.fn(async () => { throw new Error("offline"); }))).toBeUndefined();
  });

  it("asks Wikipedia for nearby articles with page views, sending the contact User-Agent", async () => {
    const f = ok(page("Half Dome", 1000));
    await getWikipediaNotable(place, f);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("https://en.wikipedia.org/w/api.php");
    expect(url).toContain("generator=geosearch");
    expect(url).toContain("prop=coordinates%7Cpageviews");
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/RoadTripPhotoPlanner/);
  });
});
