import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Suggestion } from "./types";

const suggestionPopularity = vi.fn();
vi.mock("./api-client", () => ({ api: { suggestionPopularity: (...a: unknown[]) => suggestionPopularity(...a) } }));
import { loadPopularityInBatches, POPULARITY_MAX, rankSuggestions } from "./suggestion-popularity";

const s = (i: number, kind: Suggestion["kind"] = "viewpoint", popularity?: number): Suggestion => ({ osmId: `node/${i}`, name: `P${i}`, lat: i, lng: i, kind, popularity });

describe("rankSuggestions", () => {
  it("orders by kind tier, then popularity descending, keeping ties in order", () => {
    const ranked = rankSuggestions([s(1, "attraction", 99), s(2, "viewpoint", 1), s(3, "viewpoint", 40), s(4, "peak"), s(5, "viewpoint", 40)]);
    expect(ranked.map((x) => x.osmId)).toEqual(["node/3", "node/5", "node/2", "node/4", "node/1"]);
  });
});

describe("loadPopularityInBatches", () => {
  beforeEach(() => {
    suggestionPopularity.mockReset();
  });

  it("asks 10 places at a time, in order, and reports each batch", async () => {
    suggestionPopularity.mockImplementation(async (places: unknown[]) => ({ counts: places.map(() => 5) }));
    const items = Array.from({ length: 25 }, (_, i) => s(i));
    const batches: number[] = [];
    loadPopularityInBatches(items, (found) => batches.push(found.size));
    await vi.waitFor(() => expect(batches).toEqual([10, 10, 5]));
    expect(suggestionPopularity.mock.calls.map((c) => c[0].length)).toEqual([10, 10, 5]);
  });

  it("skips places that already have a count, caps at the first 40, and ignores unknown counts", async () => {
    suggestionPopularity.mockImplementation(async (places: unknown[]) => ({ counts: places.map((_, i) => (i === 0 ? null : 3)) }));
    const items = [s(0, "viewpoint", 12), ...Array.from({ length: 60 }, (_, i) => s(i + 1))];
    const batches: Map<string, number>[] = [];
    loadPopularityInBatches(items, (found) => batches.push(found));
    await vi.waitFor(() => expect(suggestionPopularity).toHaveBeenCalledTimes(4));
    const asked = suggestionPopularity.mock.calls.reduce((n, c) => n + c[0].length, 0);
    expect(asked).toBe(POPULARITY_MAX - 1);
    expect(batches[0].has("node/1")).toBe(false); // first of the batch came back null
  });

  it("stops after cancel and survives a failed batch", async () => {
    suggestionPopularity.mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ counts: Array(10).fill(1) });
    const items = Array.from({ length: 20 }, (_, i) => s(i));
    const onBatch = vi.fn();
    const cancel = loadPopularityInBatches(items, onBatch);
    await vi.waitFor(() => expect(suggestionPopularity).toHaveBeenCalledTimes(2));
    cancel();
    await new Promise((r) => setTimeout(r, 20));
    expect(onBatch.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
