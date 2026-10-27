import { describe, expect, it } from "vitest";
import { retickTarget } from "./swap-undo";

const ids = (...a: string[]) => a.map((id) => ({ id }));

describe("retickTarget", () => {
  it("returns the last stop of the run directly after the swapped stop", () => {
    expect(retickTarget(ids("a", "b", "c", "d"), "a", ["b", "c"])).toBe("c");
  });
  it("accepts the run in a different internal order but still returns the last one in the list", () => {
    expect(retickTarget(ids("a", "c", "b", "d"), "a", ["b", "c"])).toBe("b");
  });
  it("refuses when another stop moved into the run", () => {
    expect(retickTarget(ids("a", "x", "b", "c"), "a", ["b", "c"])).toBeUndefined();
  });
  it("refuses when a cascaded stop was removed or moved before the swapped stop", () => {
    expect(retickTarget(ids("c", "a", "b", "d"), "a", ["b", "c"])).toBeUndefined();
    expect(retickTarget(ids("a", "b"), "a", ["b", "c"])).toBeUndefined();
  });
  it("refuses with nothing cascaded or a missing swapped stop", () => {
    expect(retickTarget(ids("a", "b"), "a", [])).toBeUndefined();
    expect(retickTarget(ids("b", "c"), "a", ["b"])).toBeUndefined();
  });
});
