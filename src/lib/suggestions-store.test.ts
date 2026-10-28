// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Suggestion } from "@/lib/types";
import { MemoryStorage } from "../../tests/helpers/memory-storage";
import { clearAllSuggestions, loadSuggestions, MAX_AGE_MS, MAX_BYTES, removeSuggestions, saveSuggestions } from "./suggestions-store";

const item = (n: number, extra: Partial<Suggestion> = {}): Suggestion => ({ osmId: `node/${n}`, name: `Spot ${n}`, lat: 34 + n / 100, lng: -118, kind: "viewpoint", ...extra });
const KEY = JSON.stringify([[-118, 34], [-117, 35]]);
const NOW = new Date("2026-07-01T12:00:00Z");

let mem: MemoryStorage;
beforeEach(() => {
  mem = new MemoryStorage();
  Object.defineProperty(globalThis, "sessionStorage", { value: mem, configurable: true, writable: true });
});
afterEach(() => vi.restoreAllMocks());

describe("suggestions-store", () => {
  it("round-trips a finished list", () => {
    const items = [item(1, { popularity: 7, notable: true }), item(2)];
    expect(saveSuggestions("t1", { key: KEY, items }, NOW)).toBe(true);
    expect(loadSuggestions("t1", NOW)).toEqual({ key: KEY, items });
  });

  it("keeps trips apart", () => {
    saveSuggestions("t1", { key: KEY, items: [item(1)] }, NOW);
    expect(loadSuggestions("t2", NOW)).toBeNull();
  });

  it("ignores malformed data of every kind", () => {
    const k = "rtpp.suggestions.v1.t1";
    const bad = [
      "not json",
      "null",
      "[]",
      JSON.stringify({ v: 2, savedAt: NOW.getTime(), key: KEY, items: [] }),
      JSON.stringify({ v: 1, savedAt: "x", key: KEY, items: [] }),
      JSON.stringify({ v: 1, savedAt: NOW.getTime(), key: "nope", items: [] }),
      JSON.stringify({ v: 1, savedAt: NOW.getTime(), key: "[[1]]", items: [] }),
      JSON.stringify({ v: 1, savedAt: NOW.getTime(), key: KEY, items: "x" }),
      JSON.stringify({ v: 1, savedAt: NOW.getTime(), key: KEY, items: [{ osmId: "a" }] }),
      JSON.stringify({ v: 1, savedAt: NOW.getTime(), key: KEY, items: [{ ...item(1), kind: "bogus" }] }),
      JSON.stringify({ v: 1, savedAt: NOW.getTime(), key: KEY, items: [{ ...item(1), lat: "1" }] }),
    ];
    for (const b of bad) {
      sessionStorage.setItem(k, b);
      expect(loadSuggestions("t1", NOW), b).toBeNull();
    }
  });

  it("ignores an expired list and a list from the future", () => {
    saveSuggestions("t1", { key: KEY, items: [item(1)] }, NOW);
    expect(loadSuggestions("t1", new Date(NOW.getTime() + MAX_AGE_MS - 1))).not.toBeNull();
    expect(loadSuggestions("t1", new Date(NOW.getTime() + MAX_AGE_MS + 1))).toBeNull();
    expect(loadSuggestions("t1", new Date(NOW.getTime() - 60_000))).toBeNull();
  });

  it("skips an oversize list and drops the older stored one", () => {
    saveSuggestions("t1", { key: KEY, items: [item(1)] }, NOW);
    const big = Array.from({ length: 2000 }, (_, i) => item(i, { name: "x".repeat(200) }));
    expect(saveSuggestions("t1", { key: KEY, items: big }, NOW)).toBe(false);
    expect(JSON.stringify(big).length).toBeGreaterThan(MAX_BYTES);
    expect(loadSuggestions("t1", NOW)).toBeNull();
  });

  it("is harmless when storage throws", () => {
    vi.spyOn(mem, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(mem, "setItem").mockImplementation(() => { throw new Error("full"); });
    vi.spyOn(mem, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(mem, "key").mockImplementation(() => { throw new Error("blocked"); });
    expect(loadSuggestions("t1", NOW)).toBeNull();
    expect(saveSuggestions("t1", { key: KEY, items: [item(1)] }, NOW)).toBe(false);
    expect(() => removeSuggestions("t1")).not.toThrow();
    expect(() => clearAllSuggestions()).not.toThrow();
  });

  it("removes one trip's list or all of them", () => {
    saveSuggestions("t1", { key: KEY, items: [item(1)] }, NOW);
    saveSuggestions("t2", { key: KEY, items: [item(2)] }, NOW);
    sessionStorage.setItem("other", "keep");
    removeSuggestions("t1");
    expect(loadSuggestions("t1", NOW)).toBeNull();
    expect(loadSuggestions("t2", NOW)).not.toBeNull();
    clearAllSuggestions();
    expect(loadSuggestions("t2", NOW)).toBeNull();
    expect(sessionStorage.getItem("other")).toBe("keep");
  });
});
