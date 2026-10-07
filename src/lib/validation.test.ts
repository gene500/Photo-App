import { describe, expect, it } from "vitest";
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
      "plannedDate: Planned date must be a valid YYYY-MM-DD date",
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

describe("signupSchema", () => {
  it("normalizes the email", () => {
    expect(signupSchema.parse({ email: "  Foo@Bar.COM ", password: "longenough" })).toEqual({
      email: "foo@bar.com",
      password: "longenough",
    });
  });

  it("rejects short passwords", () => {
    const r = signupSchema.safeParse({ email: "a@b.co", password: "short" });
    expect(formatZodError(r.error!)).toBe("password: Password must be at least 8 characters");
  });
});

describe("directionsRequestSchema", () => {
  it("caps waypoints at 25", () => {
    const coords = Array.from({ length: 26 }, (_, i) => [i * 0.01, 0] as [number, number]);
    const r = directionsRequestSchema.safeParse({ coordinates: coords });
    expect(formatZodError(r.error!)).toBe("coordinates: Routing supports at most 25 stops per trip");
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
