import { describe, expect, it } from "vitest";
import { diffIds } from "./diff-ids";

describe("diffIds", () => {
  it("splits ids into add, keep and remove", () => {
    expect(diffIds(["a", "b", "c"], ["b", "c", "d"])).toEqual({ add: ["d"], keep: ["b", "c"], remove: ["a"] });
  });
  it("handles empty sides", () => {
    expect(diffIds([], ["x"])).toEqual({ add: ["x"], keep: [], remove: [] });
    expect(diffIds(["x"], [])).toEqual({ add: [], keep: [], remove: ["x"] });
  });
});
