import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LngLat, Suggestion } from "@/lib/types";
import { prisma } from "../db";
import { clearSuggestionCache, findSuggestions, SUGGESTION_CACHE_TTL_MS } from "./service";
import { SHARED_PRUNE_AGE_MS, SHARED_READ_TIMEOUT_MS, sharedGet, sharedPut, sweepSuggestionCache } from "./shared-cache";

const spot = (n: number): Suggestion => ({ osmId: `node/${n}`, name: `Spot ${n}`, lat: 37.2, lng: -119.6, kind: "viewpoint" });
const ROUTE: LngLat[] = [[-119.79, 36.74], [-119.6, 37.2], [-119.12, 37.96]];
const overpassJson = { elements: [{ type: "node", id: 1, lat: 37.2, lon: -119.6, tags: { tourism: "viewpoint", name: "Spot" } }] };
const offline = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;

describe("shared suggestion cache", () => {
  beforeEach(async () => {
    vi.stubEnv("SUGGESTION_SHARED_CACHE_DISABLED", "0");
    await prisma.$executeRaw`DELETE FROM "SuggestionCache"`;
    clearSuggestionCache();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("stores both kinds per key and returns only entries younger than the age given", async () => {
    await sharedPut("k", "enriched", [spot(1)], 1_000);
    await sharedPut("k", "raw", [spot(2)], 2_000);
    const hit = await sharedGet("k", 5_000, 3_000);
    expect(hit.enriched?.value).toEqual([spot(1)]);
    expect(hit.raw?.createdAt).toBe(2_000);
    expect(await sharedGet("k", 1_500, 3_000)).toEqual({ raw: { value: [spot(2)], createdAt: 2_000 } });
    expect(await sharedGet("other", 5_000, 3_000)).toEqual({});
  });

  it("prunes rows too old to serve while writing, not only in the daily cron", async () => {
    const now = SHARED_PRUNE_AGE_MS * 3;
    await sharedPut("old", "raw", [spot(1)], 1_000);
    const rnd = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      await sharedPut("new", "raw", [spot(2)], now);
      await vi.waitFor(async () => expect(await prisma.suggestionCache.count()).toBe(1));
    } finally {
      rnd.mockRestore();
    }
    expect((await sharedGet("new", 5_000, now)).raw).toBeTruthy();
  });

  it("counts a read that takes too long as a miss", async () => {
    vi.useFakeTimers();
    const slow = vi.spyOn(prisma, "$queryRaw").mockReturnValue(new Promise(() => {}) as never);
    try {
      const pending = sharedGet("k", 5_000, 3_000);
      await vi.advanceTimersByTimeAsync(SHARED_READ_TIMEOUT_MS + 1);
      expect(await pending).toEqual({});
    } finally {
      slow.mockRestore();
      vi.useRealTimers();
    }
  });

  it("replaces an entry written again", async () => {
    await sharedPut("k", "raw", [spot(1)], 1_000);
    await sharedPut("k", "raw", [spot(2)], 2_000);
    expect((await sharedGet("k", 5_000, 3_000)).raw?.value).toEqual([spot(2)]);
  });

  it("sweeps entries past the age", async () => {
    await sharedPut("old", "raw", [spot(1)], 1_000);
    await sharedPut("new", "raw", [spot(1)], 9_000);
    expect(await sweepSuggestionCache(5_000, 10_000)).toBe(1);
    expect(await sharedGet("old", 99_000, 10_000)).toEqual({});
    expect((await sharedGet("new", 99_000, 10_000)).raw).toBeDefined();
  });

  it("does nothing when switched off", async () => {
    vi.stubEnv("SUGGESTION_SHARED_CACHE_DISABLED", "1");
    await sharedPut("k", "raw", [spot(1)]);
    expect(await sharedGet("k", 5_000)).toEqual({});
  });

  it("lets a second instance reuse a search the first one paid for", async () => {
    const fetchOverpass = vi.fn(async () => overpassJson);
    const first = await findSuggestions(ROUTE, { fetchOverpass, fetchImpl: offline, local: async () => null, localPartial: async () => null });
    // Wait for the fire-and-forget write.
    await vi.waitFor(async () => expect(await prisma.$queryRaw`SELECT 1 FROM "SuggestionCache" WHERE "kind" = 'raw'`).toHaveLength(1));
    clearSuggestionCache(); // a different instance: empty memory
    const second = await findSuggestions(ROUTE, { fetchOverpass, fetchImpl: offline, local: async () => null, localPartial: async () => null });
    expect(second).toEqual(first);
    expect(fetchOverpass).toHaveBeenCalledTimes(1);
  });

  it("ignores a stored result older than the cache lifetime", async () => {
    const fetchOverpass = vi.fn(async () => overpassJson);
    const deps = { fetchOverpass, fetchImpl: offline, local: async () => null, localPartial: async () => null };
    await findSuggestions(ROUTE, deps);
    await vi.waitFor(async () => expect(await prisma.$queryRaw`SELECT 1 FROM "SuggestionCache" WHERE "kind" = 'raw'`).toHaveLength(1));
    await prisma.$executeRaw`UPDATE "SuggestionCache" SET "createdAt" = ${Date.now() - SUGGESTION_CACHE_TTL_MS - 1_000}`;
    clearSuggestionCache();
    await findSuggestions(ROUTE, deps);
    expect(fetchOverpass).toHaveBeenCalledTimes(2);
  });
});
