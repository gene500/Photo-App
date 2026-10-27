import { describe, expect, it } from "vitest";
import { dateOnlySchema, dwellMinutesSchema, formatZodError, tripPatchSchema } from "./validation";

describe("date range", () => {
  it("rejects years outside 1970-2200", () => {
    expect(dateOnlySchema.safeParse("0050-01-01").success).toBe(false);
    expect(dateOnlySchema.safeParse("2500-01-01").success).toBe(false);
    expect(dateOnlySchema.safeParse("2026-07-01").success).toBe(true);
  });
  it("rejects a departAt in year 10000 or before 1970", () => {
    expect(tripPatchSchema.safeParse({ departAt: "+010000-01-01T00:00:00Z" }).success).toBe(false);
    expect(tripPatchSchema.safeParse({ departAt: "1900-01-01T00:00:00Z" }).success).toBe(false);
    expect(tripPatchSchema.safeParse({ departAt: "2026-07-01T08:00:00Z" }).success).toBe(true);
    expect(tripPatchSchema.safeParse({ departAt: null }).success).toBe(true);
  });
});

describe("suggestions route length", () => {
  it("rejects a zigzag that is not a real driving route", async () => {
    const { suggestionsRequestSchema } = await import("./validation");
    const zig = Array.from({ length: 200 }, (_, i): [number, number] => [i % 2 ? -70 : -122, 26 + i * 0.11]);
    expect(suggestionsRequestSchema.safeParse({ coordinates: zig }).success).toBe(false);
    expect(suggestionsRequestSchema.safeParse({ coordinates: [[-122.4, 37.8], [-118.2, 34.05]] }).success).toBe(true);
  });
});

describe("number range messages", () => {
  it("names the limit instead of saying the value is not valid", () => {
    const bad = tripPatchSchema.safeParse({ departAt: undefined, name: "x" });
    expect(bad.success).toBe(true);
    const r = dwellMinutesSchema.safeParse(9999);
    expect(r.success).toBe(false);
    if (!r.success) expect(formatZodError(r.error)).toBe("This field must be at most 480");
    const low = dwellMinutesSchema.safeParse(-1);
    if (!low.success) expect(formatZodError(low.error)).toBe("This field must be at least 0");
  });
});
