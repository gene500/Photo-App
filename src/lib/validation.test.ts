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
  start: { name: "Fresno, CA", lat: 36.74, lng: -119.79 },
  end: { name: "Lee Vining, CA", lat: 37.96, lng: -119.12 },
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

  it("rejects out-of-range coordinates", () => {
    const r = tripInputSchema.safeParse({ ...validTrip, start: { ...validTrip.start, lat: 95 } });
    expect(r.success).toBe(false);
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
    expect(formatZodError(r.error!)).toBe("coordinates: Routing supports at most 23 stops per trip");
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
