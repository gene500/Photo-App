import { describe, expect, it } from "vitest";
import { formatSavedAt, formatDistance, formatDuration, formatPhotoCount, formatRadiusKm } from "./format";

describe("format", () => {
  it("formats distance in whole km", () => {
    expect(formatDistance(140_400)).toBe("140 km");
  });
  it("formats durations", () => {
    expect(formatDuration(9_000)).toBe("2 h 30 min");
    expect(formatDuration(2_700)).toBe("45 min");
  });
});

describe("formatPhotoCount", () => {
  it("formats counts and hides nothing-to-say values", () => {
    expect(formatPhotoCount(undefined)).toBeNull();
    expect(formatPhotoCount(0)).toBeNull();
    expect(formatPhotoCount(1)).toBe("≈1 photo nearby");
    expect(formatPhotoCount(87)).toBe("≈87 photos nearby");
    expect(formatPhotoCount(50)).toBe("50+ photos nearby");
    expect(formatPhotoCount(1234)).toBe("≈1.2k photos nearby");
    expect(formatPhotoCount(2000)).toBe("≈2k photos nearby");
    expect(formatPhotoCount(12500)).toBe("≈12.5k photos nearby");
  });
});

describe("units", () => {
  it("formats distance in miles", () => {
    expect(formatDistance(160_934, "mi")).toBe("100 mi");
    expect(formatDistance(140_400, "mi")).toBe("87 mi");
    expect(formatDistance(140_400, "km")).toBe("140 km");
  });
  it("converts a km radius", () => {
    expect(formatRadiusKm(10)).toBe("10 km");
    expect(formatRadiusKm(10, "mi")).toBe("6 mi");
  });
});

describe("formatSavedAt", () => {
  it("honours the time format and tolerates garbage", () => {
    const iso = "2026-06-20T15:07:00Z";
    expect(formatSavedAt(iso, "24h")).not.toMatch(/AM|PM/);
    expect(formatSavedAt(iso, "12h")).toMatch(/AM|PM/);
    expect(formatSavedAt("nope")).toBe("");
  });
});
