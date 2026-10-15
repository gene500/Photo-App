import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Suggestion } from "@/lib/types";
import { cachedCounter, enrichPopularity, POPULARITY_CONCURRENCY, POPULARITY_MAX_CANDIDATES, resetSharedCounter } from "./popularity";

const s = (id: number, kind: Suggestion["kind"] = "viewpoint"): Suggestion => ({ osmId: `node/${id}`, name: `S${id}`, lat: 37, lng: -119, kind });
const idOf = (x: Suggestion) => x.osmId.replace("node/", "");

describe("enrichPopularity", () => {
  beforeEach(resetSharedCounter);
  afterEach(() => {
    delete process.env.FLICKR_API_KEY;
  });

  it("ranks by score, keeping incoming order for ties and unknowns", async () => {
    const counts: Record<string, number | undefined> = { "node/1": 5, "node/2": 50, "node/3": undefined, "node/4": 50, "node/5": 1000, "node/6": 0 };
    const input = [s(1), s(2), s(3), s(4), s(5, "peak"), s(6, "peak")];
    const out = await enrichPopularity(input, { count: async (x) => counts[x.osmId], notable: async () => undefined });
    expect(out.map(idOf)).toEqual(["5", "2", "4", "1", "3", "6"]);
    expect(out.find((x) => x.osmId === "node/6")?.popularity).toBe(0);
    expect(out.find((x) => x.osmId === "node/3")).not.toHaveProperty("popularity");
  });

  it("lets a popular attraction outrank an obscure viewpoint, and a Wikipedia article outrank photo counts", async () => {
    const out = await enrichPopularity([s(1), s(2, "attraction"), s(3)], {
      count: async (x) => (x.kind === "attraction" ? 9999 : 1),
      notable: async (x) => x.osmId === "node/3",
    });
    expect(out.map(idOf)).toEqual(["3", "2", "1"]);
    expect(out.find((x) => x.osmId === "node/3")?.notable).toBe(true);
    expect(out.find((x) => x.osmId === "node/1")?.notable).toBe(false);
  });

  it("leaves notable unset when the Wikipedia lookup fails", async () => {
    const out = await enrichPopularity([s(1)], { count: async () => 5, notable: async () => undefined });
    expect(out[0]).not.toHaveProperty("notable");
  });

  it("only enriches the first 40, 5 at a time", async () => {
    let active = 0;
    let peak = 0;
    const count = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      return 1;
    });
    const out = await enrichPopularity(Array.from({ length: 45 }, (_, i) => s(i)), { count });
    expect(count).toHaveBeenCalledTimes(POPULARITY_MAX_CANDIDATES);
    expect(peak).toBe(POPULARITY_CONCURRENCY);
    expect(out).toHaveLength(45);
    expect(out.filter((x) => x.popularity !== undefined)).toHaveLength(40);
  });

  it("tolerates failures and garbage per suggestion", async () => {
    const count = vi.fn(async (x: Suggestion) => {
      if (x.osmId === "node/1") throw new Error("boom");
      if (x.osmId === "node/2") return NaN;
      return 7;
    });
    const out = await enrichPopularity([s(1), s(2), s(3)], { count });
    expect(out.map((x) => x.popularity)).toEqual([7, undefined, undefined]);
    expect(await enrichPopularity([], { count })).toEqual([]);
  });

  it("uses Commons file counts (capped at 50) without a Flickr key", async () => {
    const urls: string[] = [];
    const hits = (n: number) => ({ query: { geosearch: Array.from({ length: n }, (_, i) => ({ pageid: i, ns: 6, title: `File:${i}.jpg`, dist: i })) } });
    const fetchImpl = vi.fn(async (u: string | URL | Request) => {
      urls.push(String(u));
      return new Response(JSON.stringify(hits(60)));
    }) as unknown as typeof fetch;
    const out = await enrichPopularity([s(1)], { fetchImpl });
    expect(out[0].popularity).toBe(50);
    const q = new URL(urls[0]);
    expect(q.origin + q.pathname).toBe("https://commons.wikimedia.org/w/api.php");
    expect(Object.fromEntries(q.searchParams)).toMatchObject({ list: "geosearch", gsradius: "250", gsnamespace: "6", gslimit: "50", gscoord: "37|-119" });
  });

  it("prefers Flickr totals when a key is set, and does not fall back to Commons on Flickr failure", async () => {
    process.env.FLICKR_API_KEY = "k";
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (u: string | URL | Request) => {
      urls.push(String(u));
      return new Response(JSON.stringify({ stat: "ok", photos: { total: "6170", photo: [] } }));
    }) as unknown as typeof fetch;
    const noWiki = async () => undefined;
    expect((await enrichPopularity([s(1)], { fetchImpl, notable: noWiki }))[0].popularity).toBe(6170);
    expect(urls[0]).toContain("api.flickr.com");
    resetSharedCounter(); // the Flickr answer above is remembered per place
    const failing = vi.fn(async () => new Response(JSON.stringify({ stat: "fail" }))) as unknown as typeof fetch;
    expect((await enrichPopularity([s(1)], { fetchImpl: failing, notable: noWiki }))[0].popularity).toBeUndefined();
    expect(failing).toHaveBeenCalledTimes(1);
  });
});

describe("enrichPopularity budget", () => {
  it("returns on time and leaves slow counts out", async () => {
    const list = [{ id: "a", kind: "viewpoint", name: "A", lat: 1, lng: 1 }] as never[];
    const slow = () => new Promise<number>((r) => setTimeout(() => r(9), 300));
    const t0 = Date.now();
    const out = await enrichPopularity(list, { count: slow, budgetMs: 30 });
    expect(Date.now() - t0).toBeLessThan(250);
    expect((out[0] as { popularity?: number }).popularity).toBeUndefined();
  });
});

describe("cachedCounter", () => {
  const place = { osmId: "", name: "", kind: "viewpoint" as const, lat: 37.12345, lng: -119.54321 };

  it("counts a place once, including two asked at the same time, and shares a ~10 m cell", async () => {
    const count = vi.fn(async () => 7);
    const cached = cachedCounter(count);
    const [a, b] = await Promise.all([cached(place, fetch), cached({ ...place, lat: 37.123449 }, fetch)]);
    expect([a, b]).toEqual([7, 7]);
    expect(await cached(place, fetch)).toBe(7);
    expect(count).toHaveBeenCalledTimes(1);
  });

  it("does not remember a failure, and forgets a count after 6 hours", async () => {
    let t = 0;
    const count = vi.fn<() => Promise<number | undefined>>().mockResolvedValueOnce(undefined).mockResolvedValue(3);
    const cached = cachedCounter(count, () => t);
    expect(await cached(place, fetch)).toBeUndefined();
    expect(await cached(place, fetch)).toBe(3);
    expect(count).toHaveBeenCalledTimes(2);
    t += 6 * 3600_000 + 1;
    await cached(place, fetch);
    expect(count).toHaveBeenCalledTimes(3);
  });
});

describe("cachedNotable", () => {
  it("asks once per place and name, joins in-flight lookups, and does not remember failures", async () => {
    const { cachedNotable } = await import("./popularity");
    const check = vi.fn(async () => true as boolean | undefined);
    const cached = cachedNotable(check);
    const a = { osmId: "", name: "Half Dome", kind: "viewpoint" as const, lat: 1, lng: 1 };
    await Promise.all([cached(a, fetch), cached(a, fetch)]);
    await cached(a, fetch);
    expect(check).toHaveBeenCalledTimes(1);
    await cached({ ...a, name: "Other" }, fetch);
    expect(check).toHaveBeenCalledTimes(2);
    const flaky = vi.fn(async () => undefined as boolean | undefined);
    const c2 = cachedNotable(flaky);
    await c2(a, fetch);
    await c2(a, fetch);
    expect(flaky).toHaveBeenCalledTimes(2);
  });
});
