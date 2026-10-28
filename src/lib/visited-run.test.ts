import { describe, expect, it } from "vitest";
import { leadingVisited, pinVisitedFirst } from "./visited-run";

const stops = (flags: boolean[]) => flags.map((visited, i) => ({ id: `s${i}`, visited }));

describe("leadingVisited", () => {
  it("counts the visited run from the start", () => {
    expect(leadingVisited(stops([]))).toBe(0);
    expect(leadingVisited(stops([false, true]))).toBe(0);
    expect(leadingVisited(stops([true, true, false, true]))).toBe(2);
    expect(leadingVisited(stops([true, true]))).toBe(2);
  });
});

describe("pinVisitedFirst", () => {
  const st = (id: string, visited: boolean) => ({ id, visited });
  it("keeps visited first in their current order and applies the requested order to the rest", () => {
    expect(pinVisitedFirst([st("a", true), st("b", true), st("c", false), st("d", false)], ["d", "b", "a", "c"])).toEqual(["a", "b", "d", "c"]);
  });
});
