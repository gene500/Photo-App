import { describe, expect, it } from "vitest";
import { approxLocal, checkHours, formatDayHours, parseSimpleHours } from "./opening-hours";

describe("parseSimpleHours", () => {
  it("reads 24/7", () => {
    const w = parseSimpleHours("24/7")!;
    expect(w.every((d) => d.length === 1 && d[0]![0] === 0 && d[0]![1] === 1440)).toBe(true);
  });
  it("reads day ranges, lists, several ranges and later rules overriding earlier ones", () => {
    const w = parseSimpleHours("Mo-Fr 09:00-17:00; Sa 10:00-14:00; Su off")!;
    expect(w[0]).toEqual([[540, 1020]]);
    expect(w[4]).toEqual([[540, 1020]]);
    expect(w[5]).toEqual([[600, 840]]);
    expect(w[6]).toEqual([]);
    const l = parseSimpleHours("Mo,We 08:00-12:00,13:00-17:00")!;
    expect(l[0]).toEqual([[480, 720], [780, 1020]]);
    expect(l[1]).toEqual([]);
    expect(parseSimpleHours("Mo-Su 08:00-20:00; We off")![2]).toEqual([]);
  });
  it("keeps the end of an overnight range unclipped", () => {
    expect(parseSimpleHours("Fr 20:00-02:00")![4]).toEqual([[1200, 1560]]);
    expect(formatDayHours([[1200, 1560]])).toBe("20:00-02:00");
  });
  it("rejects times past 24:00", () => {
    for (const v of ["Mo 09:00-24:30", "Mo 24:30-23:00", "Mo 09:00-24:01", "Mo 25:00-26:00"]) expect(parseSimpleHours(v), v).toBeNull();
    expect(parseSimpleHours("Mo 09:00-24:00")![0]).toEqual([[540, 1440]]);
  });
  it("returns null for anything it does not understand", () => {
    for (const v of ["Mo-Fr 09:00-17:00; PH off", "Apr-Oct Mo-Su 09:00-17:00", "sunrise-sunset", "Mo-Fr 09:00-17:00+", "Mo[1] 09:00-10:00", "by appointment", "", "  ", "Mo-Xx 09:00-10:00", "09:00-25:00", 5, null, undefined, "x".repeat(400)]) {
      expect(parseSimpleHours(v), String(v)).toBeNull();
    }
  });
});

describe("checkHours", () => {
  const w = parseSimpleHours("Mo-Fr 09:00-17:00")!;
  it("is open inside, closed all day on an unlisted day, near within an hour, closed beyond", () => {
    expect(checkHours(w, 1, 600)).toEqual({ status: "open" });
    expect(checkHours(w, 5, 600)).toEqual({ status: "closed-day" });
    expect(checkHours(w, 1, 8 * 60 + 15)).toEqual({ status: "near", hours: "09:00-17:00" });
    expect(checkHours(w, 1, 20 * 60)).toEqual({ status: "closed", hours: "09:00-17:00" });
  });
  it("treats a late-night arrival after an overnight range as open (Fr-Sa 22:00-02:00)", () => {
    const n = parseSimpleHours("Fr-Sa 22:00-02:00")!;
    expect(checkHours(n, 5, 60)).toEqual({ status: "open" }); // Sat 01:00 is the tail of Friday's range
    expect(checkHours(n, 6, 30)).toEqual({ status: "open" }); // Sun 00:30 is the tail of Saturday's range
    expect(checkHours(n, 4, 23 * 60)).toEqual({ status: "open" });
    expect(checkHours(n, 2, 12 * 60)).toEqual({ status: "closed-day" });
  });
  it("wraps from Sunday to Monday and respects an off day after the overnight range", () => {
    const n = parseSimpleHours("Su 20:00-03:00; Mo off")!;
    expect(checkHours(n, 0, 120)).toEqual({ status: "open" });
    expect(checkHours(n, 0, 12 * 60)).toEqual({ status: "closed-day" });
  });
  it("uses a wide margin for the estimated clock: 2 h before opening is only near, never closed", () => {
    expect(checkHours(w, 1, 7 * 60)).toEqual({ status: "near", hours: "09:00-17:00" });
    expect(checkHours(w, 1, 6 * 60)).toEqual({ status: "closed", hours: "09:00-17:00" });
  });
  it("never says a day is closed within the margin of midnight", () => {
    // Saturday 00:30 estimated: the real local time might still be Friday evening, and Friday is open late
    const late = parseSimpleHours("Mo-Fr 09:00-23:30")!;
    expect(checkHours(late, 5, 30).status).toBe("near");
    expect(checkHours(w, 5, 30)).toEqual({ status: "unclear" });
    expect(checkHours(w, 5, 23 * 60 + 50)).toEqual({ status: "unclear" });
    expect(checkHours(w, 5, 12 * 60)).toEqual({ status: "closed-day" });
  });
  it("formats hours", () => {
    expect(formatDayHours([])).toBe("closed");
    expect(formatDayHours([[0, 1440]])).toBe("00:00-24:00");
  });
});

describe("approxLocal", () => {
  it("shifts by the mean solar offset and maps Monday to 0", () => {
    // Monday 2026-06-01 20:00 UTC at lng -120 is 12:00 Monday
    expect(approxLocal(Date.UTC(2026, 5, 1, 20), -120)).toEqual({ dayIndex: 0, minuteOfDay: 720 });
    // Sunday 2026-06-07 03:00 UTC at lng -120 is Saturday 19:00
    expect(approxLocal(Date.UTC(2026, 5, 7, 3), -120)).toEqual({ dayIndex: 5, minuteOfDay: 1140 });
  });
});
