import { describe, expect, it } from "vitest";
import { formatZodError, newStopSchema, popularityRequestSchema, shotChecklistSchema, tripCreateSchema, tripInputSchema } from "./validation";

describe("names made only of invisible characters", () => {
  const invisible = ["᠎", "­", "⠀", "ㅤ", "ᅟ", "ﾠ", "឴", "⁡", "⁢", "͏", "️", "\u{E0020}", "\u{1D159}", "‏", "‎"];
  it.each(invisible)("refuses %j as a trip name, stop name and shot text", (ch) => {
    const v = ` ${ch}${ch} `;
    expect(tripInputSchema.safeParse({ name: v, plannedDate: "2026-06-01" }).success).toBe(false);
    expect(newStopSchema.safeParse({ name: v, lat: 1, lng: 2, source: "manual" }).success).toBe(false);
    expect(shotChecklistSchema.safeParse([{ text: v, done: false }]).success).toBe(false);
  });
  it("still accepts joiners and variation selectors inside real text", () => {
    expect(tripInputSchema.safeParse({ name: "Family \u{1F468}‍\u{1F469}️ trip", plannedDate: "2026-06-01" }).success).toBe(true);
  });
});

describe("lone surrogates", () => {
  it("are replaced so the stored text can always be URL-encoded", () => {
    const stop = newStopSchema.parse({ name: "Bad\ud83d", lat: 1, lng: 2, source: "manual", notes: "n\udc00" });
    expect(stop.name).toBe("Bad�");
    expect(stop.notes).toBe("n�");
    expect(() => encodeURIComponent(stop.name)).not.toThrow();
    expect(shotChecklistSchema.parse([{ text: "\ud800x", done: true }])[0].text).toBe("�x");
  });
});

describe("departAt at the date edges", () => {
  const base = { name: "T", plannedDate: "2200-12-31" };
  it("checks the year as written, not the UTC instant", () => {
    expect(tripCreateSchema.safeParse({ ...base, departAt: "2200-12-31T23:59:59-12:00" }).success).toBe(true);
    expect(tripCreateSchema.safeParse({ ...base, plannedDate: "1970-01-01", departAt: "1970-01-01T00:00:00+14:00" }).success).toBe(true);
    expect(tripCreateSchema.safeParse({ ...base, departAt: "2201-01-01T00:00:00Z" }).success).toBe(false);
    expect(tripCreateSchema.safeParse({ ...base, departAt: "1969-12-31T23:59:59Z" }).success).toBe(false);
  });
});

describe("limits with clear wording", () => {
  it("the 21st shot says how many are allowed", () => {
    const r = shotChecklistSchema.safeParse(Array.from({ length: 21 }, () => ({ text: "a", done: false })));
    expect(r.success).toBe(false);
    if (!r.success) expect(formatZodError(r.error)).toBe("A stop can have at most 20 shots");
  });
  it("popularity place names are limited to 200 UTF-16 units", () => {
    const place = (name: string) => ({ places: [{ lat: 1, lng: 2, name }] });
    expect(popularityRequestSchema.safeParse(place("a".repeat(200))).success).toBe(true);
    expect(popularityRequestSchema.safeParse(place("a".repeat(201))).success).toBe(false);
    expect(popularityRequestSchema.safeParse(place("\u{1F600}".repeat(101))).success).toBe(false);
    expect(popularityRequestSchema.safeParse(place("\u{1F600}".repeat(100))).success).toBe(true);
  });
});
