import { describe, expect, it } from "vitest";
import { noticeNotes } from "./notice-notes";

const stops = [{ name: "Tioga Pass" }, { name: "Done", visited: true }];
describe("noticeNotes", () => {
  it("prefixes the stop name and skips visited or unknown stops", () => {
    const n = [
      { stopIndex: 0, kind: "closed" as const, text: "Tioga Road: closed for the season (NPS alert)", source: "NPS" as const },
      { stopIndex: 1, kind: "alert" as const, text: "x", source: "NPS" as const },
      { stopIndex: 7, kind: "alert" as const, text: "y", source: "NPS" as const },
    ];
    expect(noticeNotes(n, stops)).toEqual(["Tioga Pass: Tioga Road: closed for the season (NPS alert)"]);
    expect(noticeNotes(undefined, stops)).toEqual([]);
  });
  it("summarises extras", () => {
    const n = Array.from({ length: 8 }, (_, i) => ({ stopIndex: 0, kind: "alert" as const, text: `t${i}`, source: "NPS" as const }));
    const out = noticeNotes(n, stops);
    expect(out).toHaveLength(6);
    expect(out[5]).toBe("3 more heads-ups for your stops");
  });
});
