import { describe, expect, it } from "vitest";
import type { Stop as StopRow } from "@/generated/prisma/client";
import { parseShotChecklist, toStopDto } from "./mappers";

const row: StopRow = {
  id: "s1", tripId: "t1", order: 0, name: "A", lat: 1, lng: 2, notes: null, source: "manual", photoUrl: null,
  visited: false, lightPref: "any", dwellMinutes: 30, shotNotes: "Tripod", shotChecklist: "[]",
  createdAt: new Date(), updatedAt: new Date(),
};

describe("toStopDto shot list", () => {
  it("caps an oversized stored checklist to 20 items of 120 characters", () => {
    const big = Array.from({ length: 30 }, (_, i) => ({ text: "x".repeat(200) + i, done: false }));
    const out = parseShotChecklist(JSON.stringify(big));
    expect(out).toHaveLength(20);
    expect(out[0].text).toHaveLength(120);
  });
  it("round-trips the stored JSON checklist", () => {
    const list = [{ text: "Wide", done: true }, { text: "Detail", done: false }];
    expect(toStopDto({ ...row, shotChecklist: JSON.stringify(list) })).toMatchObject({ shotNotes: "Tripod", shotChecklist: list });
  });
  it("degrades unreadable or malformed JSON to an empty or filtered list", () => {
    expect(parseShotChecklist("not json")).toEqual([]);
    expect(parseShotChecklist('{"a":1}')).toEqual([]);
    expect(parseShotChecklist('[{"text":"ok","done":true},{"text":1},null,"x"]')).toEqual([{ text: "ok", done: true }]);
  });
});
