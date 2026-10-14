import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api-client", () => ({ api: { suggestionPopularity: vi.fn() } }));
import { api } from "./api-client";
import { adoptPrewarm, startPrewarm } from "./suggestion-prewarm";
import { POPULARITY_PARALLEL } from "./suggestion-popularity";
import type { Suggestion } from "./types";

const sug = (i: number, kind: Suggestion["kind"] = "viewpoint"): Suggestion => ({ osmId: `node/${i}`, name: `S${i}`, lat: 37 + i / 100, lng: -119, kind });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("suggestion prewarm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.suggestionPopularity).mockImplementation(async (places) => ({ counts: places.map((p) => Math.round(p.lat * 100)) }));
  });

  it("looks up popularity as soon as the places arrive and adopts a ranked result", async () => {
    const found = [sug(1), sug(2), sug(3)];
    const p = startPrewarm(async () => found);
    expect(await p.items).toEqual(found);
    await flush();
    expect(p.complete()).toBe(true);
    const adopted = adoptPrewarm(found, p);
    expect(adopted.settled).toBe(true);
    expect(adopted.items.map((s) => s.osmId)).toEqual(["node/3", "node/2", "node/1"]);
  });

  it("adopts partial popularity as not settled", async () => {
    vi.mocked(api.suggestionPopularity).mockImplementation(() => new Promise(() => {}));
    const found = Array.from({ length: 7 }, (_, i) => sug(i));
    const p = startPrewarm(async () => found);
    await p.items;
    await flush();
    const adopted = adoptPrewarm(found, p);
    expect(adopted.settled).toBe(false);
    expect(adopted.items.map((s) => s.osmId)).toEqual(found.map((s) => s.osmId));
  });

  it("rejects when the search fails and never asks for popularity; cancel stops lookups", async () => {
    const p = startPrewarm(async () => { throw new Error("down"); });
    await expect(p.items).rejects.toThrow("down");
    expect(api.suggestionPopularity).not.toHaveBeenCalled();
    const q = startPrewarm(async () => [sug(1)]);
    q.cancel();
    await q.items;
    await flush();
    expect(api.suggestionPopularity).not.toHaveBeenCalled();
  });

  it("asks for a full list of popularity in one round trip", () => {
    expect(POPULARITY_PARALLEL).toBeGreaterThanOrEqual(8);
  });
});
