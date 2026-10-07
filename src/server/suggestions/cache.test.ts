import { describe, expect, it } from "vitest";
import { TtlCache } from "./cache";

describe("TtlCache", () => {
  it("returns values until they expire", () => {
    let now = 0;
    const cache = new TtlCache<string>(1000, 10, () => now);
    cache.set("k", "v");
    now = 999;
    expect(cache.get("k")).toBe("v");
    now = 1000;
    expect(cache.get("k")).toBeUndefined();
  });

  it("evicts the oldest entry beyond maxEntries", () => {
    const cache = new TtlCache<number>(1000, 2, () => 0);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });
});
