import { describe, expect, it } from "vitest";
import { fromTimeValue, toTimeValue } from "./StartTimeControl";

// The clock is the viewer's; pin a zone with DST so the suite gives the same answer on any machine.
process.env.TZ = "America/New_York";

describe("fromTimeValue on a daylight-saving change day", () => {
  it("spring forward: a clock time that does not exist (02:30 on 2026-03-08) resolves forward to 03:30 EDT", () => {
    for (const lng of [undefined, -74]) {
      const iso = fromTimeValue("2026-03-08", "02:30", lng);
      expect(iso).toBe("2026-03-08T07:30:00.000Z");
      expect(toTimeValue(iso)).toBe("03:30");
    }
  });
  it("spring forward: times either side of the gap are unchanged", () => {
    expect(fromTimeValue("2026-03-08", "01:59")).toBe("2026-03-08T06:59:00.000Z"); // EST
    expect(fromTimeValue("2026-03-08", "03:00")).toBe("2026-03-08T07:00:00.000Z"); // EDT
  });
  it("fall back: an ambiguous clock time (01:30 on 2026-11-01) is the first one, in EDT", () => {
    for (const lng of [undefined, -74]) expect(fromTimeValue("2026-11-01", "01:30", lng)).toBe("2026-11-01T05:30:00.000Z");
  });
  it("fall back: times after the repeated hour are in EST", () => {
    expect(fromTimeValue("2026-11-01", "02:30")).toBe("2026-11-01T07:30:00.000Z");
  });
});
