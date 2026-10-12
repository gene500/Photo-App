import { describe, expect, it } from "vitest";
import { dateOnlySchema, tripPatchSchema } from "./validation";

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
