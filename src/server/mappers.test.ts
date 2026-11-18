import { describe, expect, it } from "vitest";
import type { Stop as StopRow } from "@/generated/prisma/client";
import { parseShotChecklist, toPublicTripDto, toStopDto } from "./mappers";

const row: StopRow = {
  id: "s1", tripId: "t1", order: 0, name: "A", lat: 1, lng: 2, notes: null, source: "manual", photoUrl: null,
  visited: false, lightPref: "any", priority: "normal", dwellMinutes: 30, shotNotes: "Tripod", shotChecklist: "[]",
  accessLat: null, accessLng: null, accessName: null, accessWalkMeters: null, accessResolvedAt: null,
  createdAt: new Date(), updatedAt: new Date(),
};

describe("toStopDto shot list", () => {
  it("caps an oversized stored checklist to 20 items of 120 characters", () => {
    const big = Array.from({ length: 30 }, (_, i) => ({ text: "x".repeat(200) + i, done: false }));
    const out = parseShotChecklist(JSON.stringify(big));
    expect(out).toHaveLength(20);
    expect(out[0].text).toHaveLength(120);
  });
  it("never cuts a surrogate pair when capping an item (encodeURIComponent must not throw)", () => {
    const text = "x".repeat(119) + "\u{1F600}"; // the pair straddles the 120-unit cap
    const out = parseShotChecklist(JSON.stringify([{ text, done: false }]));
    expect(out[0].text).toBe("x".repeat(119));
    expect(() => encodeURIComponent(out[0].text)).not.toThrow();
  });
  it("round-trips the stored JSON checklist", () => {
    const list = [{ text: "Wide", done: true }, { text: "Detail", done: false }];
    expect(toStopDto({ ...row, shotChecklist: JSON.stringify(list) })).toMatchObject({ shotNotes: "Tripod", shotChecklist: list });
  });
  it("degrades unreadable or malformed JSON to an empty or filtered list", () => {
    expect(parseShotChecklist("not json")).toEqual([]);
    expect(parseShotChecklist('{"a":1}')).toEqual([]);
    expect(parseShotChecklist('[{"text":"ok","done":true},{"text":1},null,"x"]')).toEqual([{ text: "ok", done: true }]);
    // Items holding only invisible characters would make the next save return 400, so they are dropped on read.
    expect(parseShotChecklist(JSON.stringify([{ text: "\u200B\u00AD", done: false }, { text: "  ", done: true }, { text: "ok", done: false }]))).toEqual([{ text: "ok", done: false }]);
  });
});

describe("stored text written before the bidi rule", () => {
  it("is cleaned on the way out (notes, shot notes and checklist items), keeping newlines", () => {
    const dto = toStopDto({ ...row, notes: "a\u202Eb\u2028c\nd", shotNotes: "x\u2066y\u2029z", shotChecklist: JSON.stringify([{ text: "t\u202Eu", done: false }]) });
    expect(dto).toMatchObject({ notes: "abc\nd", shotNotes: "xyz", shotChecklist: [{ text: "tu", done: false }] });
  });
});

describe("enum-like stored fields", () => {
  it("fall back to the defaults when the stored value is outside the enum (private and public mappers)", () => {
    const bad = { ...row, lightPref: "twilight", priority: "urgent", source: "import" };
    expect(toStopDto(bad)).toMatchObject({ lightPref: "any", priority: "normal", source: "manual" });
    const trip = { id: "t", userId: "u", name: "T", plannedDate: new Date("2026-07-01T00:00:00Z"), departAt: null, shareToken: "x", routeOptimizedFor: null, createdAt: new Date(), updatedAt: new Date(), stops: [bad] };
    expect(toPublicTripDto(trip as never).stops[0]).toMatchObject({ lightPref: "any", priority: "normal", source: "manual" });
  });
});

describe("stop access point", () => {
  it("caps a stored lot name at 120 characters on read without splitting an emoji", () => {
    const long = toStopDto({ ...row, accessLat: 1, accessLng: 2, accessName: "x".repeat(300) });
    expect(long.access?.name).toBe("x".repeat(120));
    const emoji = toStopDto({ ...row, accessLat: 1, accessLng: 2, accessName: "x".repeat(119) + "\u{1F600}" });
    expect(emoji.access?.name).toBe("x".repeat(119));
  });
  it("maps the saved lot and the resolved time", () => {
    const at = new Date("2026-11-17T10:00:00Z");
    const dto = toStopDto({ ...row, accessLat: 1, accessLng: 2, accessName: "North lot", accessWalkMeters: 1930, accessResolvedAt: at });
    expect(dto.access).toEqual({ lat: 1, lng: 2, name: "North lot", walkMeters: 1930 });
    expect(dto.accessResolvedAt).toBe(at.toISOString());
  });
  it("cleans the lot name like a stop name (control characters and line breaks)", () => {
    const dto = toStopDto({ ...row, accessLat: 1, accessLng: 2, accessName: "North\u0000 lot\n\u202E" });
    expect(dto.access?.name).toBe("North lot");
    expect(dto.access?.name).not.toMatch(/[\u0000\n\u202E]/);
  });
  it("reads a lot name made only of invisible characters as no name", () => {
    expect(toStopDto({ ...row, accessLat: 1, accessLng: 2, accessName: "\u200B\u200D" }).access?.name).toBeNull();
  });
  it("is null when lat or lng is missing, even with a name", () => {
    expect(toStopDto({ ...row, accessLat: null, accessLng: 2, accessName: "x" }).access).toBeNull();
    expect(toStopDto({ ...row, accessLat: 1, accessLng: null, accessName: "x" }).access).toBeNull();
    expect(toStopDto(row)).toMatchObject({ access: null, accessResolvedAt: null });
  });
  it("public stops carry access but never accessResolvedAt", () => {
    const trip = { id: "t", name: "T", plannedDate: new Date("2026-11-17T00:00:00Z"), departAt: null, shareToken: null, routeOptimizedFor: null, userId: "u", createdAt: new Date(), updatedAt: new Date(), stops: [{ ...row, accessLat: 1, accessLng: 2, accessName: "L", accessWalkMeters: 640, accessResolvedAt: new Date() }] } as unknown as Parameters<typeof toPublicTripDto>[0];
    const s = toPublicTripDto(trip).stops[0];
    expect(s.access).toEqual({ lat: 1, lng: 2, name: "L", walkMeters: 640 });
    expect("accessResolvedAt" in s).toBe(false);
  });
});
