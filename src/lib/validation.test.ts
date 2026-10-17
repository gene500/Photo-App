import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  directionsRequestSchema,
  formatZodError,
  newStopSchema,
  signupSchema,
  stopPatchSchema,
  suggestionsRequestSchema,
  tripInputSchema,
  tripPatchSchema,
} from "./validation";

const validTrip = {
  name: "Sierra loop",
  plannedDate: "2026-07-01",
};

describe("tripInputSchema", () => {
  it("accepts a valid trip", () => {
    expect(tripInputSchema.parse(validTrip)).toEqual(validTrip);
  });

  it("rejects an impossible planned date", () => {
    const r = tripInputSchema.safeParse({ ...validTrip, plannedDate: "2026-02-30" });
    expect(r.success).toBe(false);
    expect(formatZodError(r.error!)).toBe(
      "Planned date must be a valid YYYY-MM-DD date",
    );
  });

  it("ignores legacy start/end fields", () => {
    const parsed = tripInputSchema.parse({ ...validTrip, start: { name: "x", lat: 95, lng: 0 } });
    expect(parsed).toEqual(validTrip);
  });
});

describe("tripPatchSchema", () => {
  it("accepts a partial patch", () => {
    expect(tripPatchSchema.parse({ name: "New name" })).toEqual({ name: "New name" });
  });

  it("rejects an empty patch", () => {
    expect(formatZodError(tripPatchSchema.safeParse({}).error!)).toBe("Nothing to update");
  });
});

describe("newStopSchema", () => {
  it("requires a known source", () => {
    expect(newStopSchema.safeParse({ name: "X", lat: 1, lng: 1, source: "other" }).success).toBe(false);
    expect(newStopSchema.safeParse({ name: "X", lat: 1, lng: 1, source: "manual" }).success).toBe(true);
  });
});

describe("stopPatchSchema", () => {
  it("accepts visited only", () => {
    expect(stopPatchSchema.parse({ visited: true })).toEqual({ visited: true });
  });

  it("allows clearing notes with null", () => {
    expect(stopPatchSchema.parse({ notes: null })).toEqual({ notes: null });
  });

  it("accepts a coordinate move", () => {
    expect(stopPatchSchema.parse({ lat: 37.5, lng: -119.5 })).toEqual({ lat: 37.5, lng: -119.5 });
  });

  it("rejects out-of-range coordinates", () => {
    expect(stopPatchSchema.safeParse({ lat: 95, lng: 0 }).success).toBe(false);
    expect(stopPatchSchema.safeParse({ lat: 0, lng: -181 }).success).toBe(false);
  });

  it("accepts a swap: name, place, source and clearing the photo", () => {
    const swap = { name: "  Tunnel View ", lat: 37.7, lng: -119.6, source: "suggested", visited: false, photoUrl: null };
    expect(stopPatchSchema.parse(swap)).toEqual({ ...swap, name: "Tunnel View" });
  });

  it("validates name, source and photoUrl like stop creation", () => {
    expect(stopPatchSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(stopPatchSchema.safeParse({ name: "x".repeat(201) }).success).toBe(false);
    expect(stopPatchSchema.safeParse({ source: "other" }).success).toBe(false);
    // A photo can only be cleared here; setting one goes through the upload route.
    expect(stopPatchSchema.safeParse({ photoUrl: "/api/uploads/x.png" }).success).toBe(false);
  });
});

describe("light-aware fields", () => {
  it("defaults new stops to any light and 30 minutes", () => {
    expect(newStopSchema.parse({ name: "a", lat: 1, lng: 2, source: "manual" })).toMatchObject({ lightPref: "any", dwellMinutes: 30 });
  });
  it("validates light preference and dwell range", () => {
    expect(stopPatchSchema.safeParse({ lightPref: "dusk" }).success).toBe(false);
    expect(stopPatchSchema.safeParse({ dwellMinutes: 481 }).success).toBe(false);
    expect(stopPatchSchema.safeParse({ dwellMinutes: -1 }).success).toBe(false);
    expect(stopPatchSchema.safeParse({ dwellMinutes: 1.5 }).success).toBe(false);
    expect(stopPatchSchema.parse({ lightPref: "sunrise", dwellMinutes: 480 })).toEqual({ lightPref: "sunrise", dwellMinutes: 480 });
  });
  it("accepts departAt as an ISO string or null on a trip patch", () => {
    expect(tripPatchSchema.parse({ departAt: null })).toEqual({ departAt: null });
    expect(tripPatchSchema.parse({ departAt: "2026-07-01T17:42:00Z" })).toEqual({ departAt: "2026-07-01T17:42:00Z" });
    expect(tripPatchSchema.safeParse({ departAt: "tomorrow" }).success).toBe(false);
  });
});

describe("shot list fields", () => {
  const item = { text: "Wide from the rail", done: false };
  it("defaults to nothing and accepts notes and a checklist", () => {
    const parsed = newStopSchema.parse({ name: "a", lat: 1, lng: 2, source: "manual" });
    expect(parsed.shotNotes).toBeUndefined();
    expect(parsed.shotChecklist).toBeUndefined();
    expect(stopPatchSchema.parse({ shotNotes: "Bring the 70-200", shotChecklist: [item] })).toEqual({ shotNotes: "Bring the 70-200", shotChecklist: [item] });
    expect(stopPatchSchema.parse({ shotNotes: null })).toEqual({ shotNotes: null });
    expect(newStopSchema.parse({ name: "a", lat: 1, lng: 2, source: "manual", shotChecklist: [item] }).shotChecklist).toEqual([item]);
  });
  it("limits notes to 2000 characters", () => {
    expect(stopPatchSchema.safeParse({ shotNotes: "x".repeat(2000) }).success).toBe(true);
    expect(stopPatchSchema.safeParse({ shotNotes: "x".repeat(2001) }).success).toBe(false);
  });
  it("limits the checklist to 20 items of 1 to 120 characters", () => {
    const many = (n: number) => Array.from({ length: n }, () => item);
    expect(stopPatchSchema.safeParse({ shotChecklist: many(20) }).success).toBe(true);
    expect(stopPatchSchema.safeParse({ shotChecklist: many(21) }).success).toBe(false);
    expect(stopPatchSchema.safeParse({ shotChecklist: [{ text: "x".repeat(120), done: true }] }).success).toBe(true);
    expect(stopPatchSchema.safeParse({ shotChecklist: [{ text: "x".repeat(121), done: true }] }).success).toBe(false);
    expect(stopPatchSchema.safeParse({ shotChecklist: [{ text: "   ", done: true }] }).success).toBe(false);
    expect(stopPatchSchema.safeParse({ shotChecklist: [{ text: "ok" }] }).success).toBe(false);
  });
  it("ignores unknown keys on items", () => {
    expect(stopPatchSchema.parse({ shotChecklist: [{ text: " a ", done: true, evil: 1 }] })).toEqual({ shotChecklist: [{ text: "a", done: true }] });
  });
});

describe("signupSchema", () => {
  it("normalizes the email", () => {
    expect(signupSchema.parse({ email: "  Foo@Bar.COM ", password: "longenough" })).toEqual({
      email: "foo@bar.com",
      password: "longenough",
    });
  });

  it("rejects short passwords", () => {
    const r = signupSchema.safeParse({ email: "a@b.co", password: "short" });
    expect(formatZodError(r.error!)).toBe("Password must be at least 8 characters");
  });
});

describe("formatZodError defaults", () => {
  it("rewrites zod's own wording from the field name", () => {
    const r = tripInputSchema.safeParse({ ...validTrip, name: "x".repeat(500) });
    expect(formatZodError(r.error!)).toMatch(/^Name must be at most \d+ characters$/);
  });
});

describe("directionsRequestSchema", () => {
  it("caps waypoints at 25", () => {
    const coords = Array.from({ length: 26 }, (_, i) => [i * 0.01, 0] as [number, number]);
    const r = directionsRequestSchema.safeParse({ coordinates: coords });
    expect(formatZodError(r.error!)).toBe("Routing supports at most 25 stops per trip");
  });
});

describe("suggestionsRequestSchema", () => {
  it("rejects a coordinates array longer than 2000 (DoS guard against @turf/simplify recursion)", () => {
    const tooMany = Array.from({ length: 2001 }, (_, i) => [i * 0.0001, 0] as [number, number]);
    const r = suggestionsRequestSchema.safeParse({ coordinates: tooMany });
    expect(r.success).toBe(false);
  });

  it("accepts a coordinates array at 2000", () => {
    const atMax = Array.from({ length: 2000 }, (_, i) => [i * 0.0001, 0] as [number, number]);
    const r = suggestionsRequestSchema.safeParse({ coordinates: atMax });
    expect(r.success).toBe(true);
  });
});

describe("signupSchema limits", () => {
  it("rejects an all-whitespace password but allows inner whitespace", () => {
    expect(signupSchema.safeParse({ email: "a@example.com", password: "        " }).success).toBe(false);
    expect(signupSchema.safeParse({ email: "a@example.com", password: "\t\n \u00a0 \t \n" }).success).toBe(false);
    expect(signupSchema.safeParse({ email: "a@example.com", password: "two words here" }).success).toBe(true);
  });

  it("rejects an email longer than 254 characters", () => {
    const email = `${"a".repeat(64)}@${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.${"e".repeat(60)}.com`;
    expect(email.length).toBeGreaterThan(254);
    expect(signupSchema.safeParse({ email, password: "correct-horse" }).success).toBe(false);
  });

  it("rejects a password over bcrypt's 72-byte limit (bcrypt would silently ignore the rest)", () => {
    const multibyte = "é".repeat(60); // 60 characters but 120 bytes
    expect(signupSchema.safeParse({ email: "a@example.com", password: multibyte }).success).toBe(false);
    expect(signupSchema.safeParse({ email: "a@example.com", password: "x".repeat(73) }).success).toBe(false);
    expect(signupSchema.safeParse({ email: "a@example.com", password: "x".repeat(72) }).success).toBe(true);
  });
});

describe("name hygiene", () => {
  const okNames = ["Café 日本 trip", "Road 🚗 trip", "👨\u200D👩\u200D👧 family", "東京タワー", "a\u200Db"];
  it.each(okNames)("accepts %j", (name) => {
    expect(tripInputSchema.safeParse({ ...validTrip, name }).success).toBe(true);
    expect(newStopSchema.safeParse({ name, lat: 1, lng: 1, source: "manual" }).success).toBe(true);
  });
  const emptyNames = ["\u200B\u200C\u200D", "\u2060\uFEFF", " \u200B ", "", "\u0000\u202E", "\t\n"];
  const dirtyNames: [string, string][] = [["a\u0000b", "ab"], ["tab\tname", "tabname"], ["new\nline", "newline"], ["a\u007Fb", "ab"], ["a\u0085b", "ab"], ["evil\u202Ename", "evilname"], ["iso\u2066late\u2069", "isolate"]];
  it.each(emptyNames)("rejects %j when nothing visible remains", (name) => {
    expect(tripInputSchema.safeParse({ ...validTrip, name }).success).toBe(false);
    expect(stopPatchSchema.safeParse({ name }).success).toBe(false);
    expect(newStopSchema.safeParse({ name, lat: 1, lng: 1, source: "manual" }).success).toBe(false);
    expect(stopPatchSchema.safeParse({ shotChecklist: [{ text: name, done: false }] }).success).toBe(false);
  });
  it.each(dirtyNames)("strips forbidden characters from %j instead of rejecting it", (name, clean) => {
    expect(tripInputSchema.parse({ ...validTrip, name }).name).toBe(clean);
    expect(stopPatchSchema.parse({ name }).name).toBe(clean);
    expect(newStopSchema.parse({ name, lat: 1, lng: 1, source: "manual" }).name).toBe(clean);
    expect(stopPatchSchema.parse({ shotChecklist: [{ text: name, done: false }] }).shotChecklist![0].text).toBe(clean);
  });
  it("strips control characters from free text but keeps newlines and tabs", () => {
    expect(stopPatchSchema.parse({ notes: "a\nb\r\n\tc", shotNotes: "x\ny" })).toEqual({ notes: "a\nb\r\n\tc", shotNotes: "x\ny" });
    expect(stopPatchSchema.parse({ notes: "a\u0000b" }).notes).toBe("ab");
    expect(stopPatchSchema.parse({ shotNotes: "a\u0007b" }).shotNotes).toBe("ab");
    expect(newStopSchema.parse({ name: "X", lat: 1, lng: 1, source: "manual", notes: "a\u001Bb" }).notes).toBe("ab");
    expect(stopPatchSchema.safeParse({ notes: "😀 日本 👨\u200D👩" }).success).toBe(true);
  });
});

describe("formatZodError wording", () => {
  it("pluralises and names the field", () => {
    const one = z.object({ name: z.string().min(1) }).safeParse({ name: "" });
    expect(formatZodError(one.error!)).toBe("Name must be at least 1 character");
    const many = z.object({ name: z.string().min(3) }).safeParse({ name: "a" });
    expect(formatZodError(many.error!)).toBe("Name must be at least 3 characters");
    const max = z.object({ name: z.string().max(1) }).safeParse({ name: "ab" });
    expect(formatZodError(max.error!)).toBe("Name must be at most 1 character");
  });
});

describe("legacy stored text does not block unrelated edits", () => {
  const legacy = "Old\u202E trip\tname";
  it("lets a date change resend a legacy trip name", () => {
    const r = tripPatchSchema.safeParse({ name: legacy, plannedDate: "2026-07-01" });
    expect(r.success && r.data.name).toBe("Old tripname");
  });
  it("lets a shot be ticked when another checklist item holds a legacy character", () => {
    const r = stopPatchSchema.safeParse({ shotChecklist: [{ text: "Wide\u0007 shot", done: true }, { text: "Tele", done: false }] });
    expect(r.success && r.data.shotChecklist).toEqual([{ text: "Wide shot", done: true }, { text: "Tele", done: false }]);
  });
  it("lets an undo resend a legacy stop name", () => {
    const r = stopPatchSchema.safeParse({ name: "Tunnel\u0085 View" });
    expect(r.success && r.data.name).toBe("Tunnel View");
  });
});
