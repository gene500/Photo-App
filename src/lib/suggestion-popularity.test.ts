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

  it("asks 5 places at a time, in order, reports each batch, then says it is done", async () => {
    suggestionPopularity.mockImplementation(async (places: unknown[]) => ({ counts: places.map(() => 5) }));
    const items = Array.from({ length: 25 }, (_, i) => s(i));
    const batches: number[] = [];
    const onDone = vi.fn();
    loadPopularityInBatches(items, (found) => batches.push(found.size), onDone);
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(batches).toEqual([5, 5, 5, 5, 5]);
    expect(suggestionPopularity.mock.calls.map((c) => c[0].length)).toEqual([5, 5, 5, 5, 5]);
  });

  it("skips places that already have a count, caps at the first 40, and ignores unknown counts", async () => {
    suggestionPopularity.mockImplementation(async (places: unknown[]) => ({ counts: places.map((_, i) => (i === 0 ? null : 3)) }));
    const items = [s(0, "viewpoint", 12), ...Array.from({ length: 60 }, (_, i) => s(i + 1))];
    const batches: Map<string, number>[] = [];
    loadPopularityInBatches(items, (found) => batches.push(found));
    await vi.waitFor(() => expect(suggestionPopularity).toHaveBeenCalledTimes(8));
    const asked = suggestionPopularity.mock.calls.reduce((n, c) => n + c[0].length, 0);
    expect(asked).toBe(POPULARITY_MAX - 1);
    expect(batches[0].has("node/1")).toBe(false); // first of the batch came back null
  });

  it("stops after cancel and survives a failed batch", async () => {
    suggestionPopularity.mockRejectedValueOnce(new Error("boom")).mockReturnValueOnce(new Promise(() => {}));
    const items = Array.from({ length: 20 }, (_, i) => s(i));
    const onBatch = vi.fn();
    const cancel = loadPopularityInBatches(items, onBatch);
    await vi.waitFor(() => expect(suggestionPopularity).toHaveBeenCalledTimes(3)); // two start together; the failed one frees a slot for the third
    cancel();
    await new Promise((r) => setTimeout(r, 20));
    expect(onBatch).toHaveBeenCalledTimes(1); // the failed batch still reports (empty) so the list keeps revealing
    expect(suggestionPopularity).toHaveBeenCalledTimes(3);
  });

  it("keeps two requests in flight but reports batches in order, even when the later one answers first", async () => {
    const resolvers: Array<(v: { counts: number[] }) => void> = [];
    suggestionPopularity.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
    const items = Array.from({ length: 15 }, (_, i) => s(i));
    const reported: string[][] = [];
    loadPopularityInBatches(items, (found) => reported.push([...found.keys()]));
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));
    resolvers[1]({ counts: [1, 1, 1, 1, 1] });
    await new Promise((r) => setTimeout(r, 10));
    expect(reported).toHaveLength(0); // batch 2 is held back until batch 1 is shown
    resolvers[0]({ counts: [1, 1, 1, 1, 1] });
    await vi.waitFor(() => expect(reported).toHaveLength(2));
    expect(reported[0][0]).toBe("node/0");
    expect(reported[1][0]).toBe("node/5");
  });
});
