import { describe, expect, it } from "vitest";
import { shiftDepartAtLocal, dateOnlyToUtc, isDateOnly, localDateOnly, utcToDateOnly } from "./dates";

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

describe("localDateOnly", () => {
  it("uses the local calendar day, not the UTC one", () => {
    expect(localDateOnly(new Date(2026, 6, 1, 23, 30))).toBe("2026-07-01");
    expect(localDateOnly(new Date(2026, 0, 5, 0, 5))).toBe("2026-01-05");
  });
});

describe("formatDateOnly / formatInstantDate", () => {
  it("writes one readable style", async () => {
    const { formatDateOnly, formatInstantDate } = await import("./dates");
    expect(formatDateOnly("2026-11-20")).toBe("Nov 20, 2026");
    expect(formatDateOnly("nope")).toBe("");
    expect(formatInstantDate("nope")).toBe("");
    expect(formatInstantDate("2026-06-20T12:00:00Z")).toMatch(/^Jun (19|20|21), 2026$/);
  });
});

describe("shiftDepartAtLocal", () => {
  const realTz = process.env.TZ;
  const inZone = (tz: string, fn: () => void) => {
    process.env.TZ = tz;
    try { fn(); } finally { if (realTz === undefined) delete process.env.TZ; else process.env.TZ = realTz; }
  };

  it("keeps the viewer's local clock time across a fall-back change (Los Angeles)", () => {
    inZone("America/Los_Angeles", () => {
      // 07:00 PDT on Oct 30 -> 07:00 PST on Nov 6
      expect(shiftDepartAtLocal("2026-10-30T14:00:00.000Z", "2026-10-30", "2026-11-06", -118.2)).toBe("2026-11-06T15:00:00.000Z");
      expect(shiftDepartAtLocal("2026-11-06T15:00:00.000Z", "2026-11-06", "2026-10-30")).toBe("2026-10-30T14:00:00.000Z");
    });
  });

  it("keeps the viewer's local clock time across a spring-forward change (Los Angeles)", () => {
    inZone("America/Los_Angeles", () => {
      // 07:00 PST on Mar 1 -> 07:00 PDT on Mar 15
      expect(shiftDepartAtLocal("2026-03-01T15:00:00.000Z", "2026-03-01", "2026-03-15", -118.2)).toBe("2026-03-15T14:00:00.000Z");
    });
  });

  it("keeps the local clock time in a positive-offset zone (Auckland, DST starts 2026-09-27)", () => {
    inZone("Pacific/Auckland", () => {
      // 10:00 NZST -> 10:00 NZDT
      expect(shiftDepartAtLocal("2026-09-19T22:00:00.000Z", "2026-09-20", "2026-09-28", 174.76)).toBe("2026-09-27T21:00:00.000Z");
      // DST ends 2027-04-04: 10:00 NZDT -> 10:00 NZST
      expect(shiftDepartAtLocal("2027-03-27T21:00:00.000Z", "2027-03-28", "2027-04-05", 174.76)).toBe("2027-04-04T22:00:00.000Z");
    });
  });

  it("falls back to whole UTC days when the clock time lands off the planned solar day (STRESS-LOG T16 tester 3, repro B)", () => {
    inZone("America/Los_Angeles", () => {
      // 00:30 PST (solar 00:38) -> clock time 00:30 PDT is solar 23:38 on Oct 19, off the new day
      expect(shiftDepartAtLocal("2026-11-02T08:30:00.000Z", "2026-11-02", "2026-10-20", -118.2)).toBe("2026-10-20T08:30:00.000Z");
    });
  });

  it("falls back to whole UTC days in a positive-offset zone (tester 3, repro A)", () => {
    inZone("Pacific/Auckland", () => {
      expect(shiftDepartAtLocal("2026-09-19T12:40:00.000Z", "2026-09-20", "2026-09-28", 174.76)).toBe("2026-09-27T12:40:00.000Z");
    });
  });

  it("with no first stop, accepts the clock time while it is the planned day somewhere on Earth", () => {
    inZone("America/Los_Angeles", () => {
      expect(shiftDepartAtLocal("2026-10-30T14:00:00.000Z", "2026-10-30", "2026-11-06")).toBe("2026-11-06T15:00:00.000Z");
    });
  });
});
