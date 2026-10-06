import { describe, expect, it } from "vitest";
import { dateOnlyToUtc, isDateOnly, utcToDateOnly } from "./dates";

describe("dates", () => {
  it("accepts real YYYY-MM-DD dates", () => {
    expect(isDateOnly("2026-07-01")).toBe(true);
    expect(isDateOnly("2028-02-29")).toBe(true);
  });

  it("rejects malformed or impossible dates", () => {
    expect(isDateOnly("2026-7-01")).toBe(false);
    expect(isDateOnly("2026-02-30")).toBe(false);
    expect(isDateOnly("not a date")).toBe(false);
  });

  it("round-trips through UTC midnight", () => {
    const d = dateOnlyToUtc("2026-07-01");
    expect(d.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(utcToDateOnly(d)).toBe("2026-07-01");
  });

  it("throws on invalid input", () => {
    expect(() => dateOnlyToUtc("2026-13-01")).toThrow("Invalid date");
  });
});
