import { describe, expect, it } from "vitest";
import { STOP_COLORS, stopColor } from "./stop-style";

describe("stopColor", () => {
  it("distinguishes source and visited status", () => {
    expect(stopColor({ source: "manual", visited: false })).toBe(STOP_COLORS.manual);
    expect(stopColor({ source: "manual", visited: true })).toBe(STOP_COLORS.manualVisited);
    expect(stopColor({ source: "suggested", visited: false })).toBe(STOP_COLORS.suggested);
    expect(stopColor({ source: "suggested", visited: true })).toBe(STOP_COLORS.suggestedVisited);
    expect(new Set(Object.values(STOP_COLORS)).size).toBe(4);
  });
});
