import { describe, expect, it } from "vitest";
import { formatDistance, formatDuration } from "./format";

describe("format", () => {
  it("formats distance in whole km", () => {
    expect(formatDistance(140_400)).toBe("140 km");
  });
  it("formats durations", () => {
    expect(formatDuration(9_000)).toBe("2 h 30 min");
    expect(formatDuration(2_700)).toBe("45 min");
  });
});
