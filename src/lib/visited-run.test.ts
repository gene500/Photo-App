import { describe, expect, it } from "vitest";
import { leadingVisited, visitedChanges } from "./visited-run";

const stops = (flags: boolean[]) => flags.map((visited, i) => ({ id: `s${i}`, visited }));

describe("visitedChanges", () => {
  it("checking a stop also checks every earlier one", () => {
    expect(visitedChanges(stops([false, false, false, false]), "s2", true)).toEqual(["s0", "s1", "s2"]);
  });
  it("skips stops that are already checked", () => {
    expect(visitedChanges(stops([true, false, false]), "s2", true)).toEqual(["s1", "s2"]);
  });
  it("unchecking a stop also unchecks every later one", () => {
    expect(visitedChanges(stops([true, true, true, false]), "s1", false)).toEqual(["s1", "s2"]);
  });
  it("changes nothing for an unknown id or a no-op toggle", () => {
    expect(visitedChanges(stops([true]), "zz", true)).toEqual([]);
    expect(visitedChanges(stops([true, false]), "s0", true)).toEqual([]);
  });
});

describe("leadingVisited", () => {
  it("counts the visited run from the start", () => {
    expect(leadingVisited(stops([]))).toBe(0);
    expect(leadingVisited(stops([false, true]))).toBe(0);
    expect(leadingVisited(stops([true, true, false, true]))).toBe(2);
    expect(leadingVisited(stops([true, true]))).toBe(2);
  });
});
