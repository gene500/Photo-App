import { describe, expect, it } from "vitest";
import { neighbourCoordinates } from "./keyboard-coordinates";

const box = (top: number, height: number) => ({ top, left: 10, width: 300, height });
const rects = [
  { id: "a", rect: box(0, 60) },
  { id: "b", rect: box(60, 60) },
  { id: "c", rect: box(120, 131) },
];

describe("neighbourCoordinates", () => {
  it("centres a tall row on a short row above it, so the row above is the closest centre", () => {
    const c = neighbourCoordinates("ArrowUp", rects, "b", box(120, 131))!;
    const centre = c.y + 131 / 2;
    expect(Math.abs(centre - 30)).toBeLessThan(Math.abs(centre - 90));
    expect(c.x).toBe(10);
  });
  it("moves one row at a time from the current over row", () => {
    expect(neighbourCoordinates("ArrowUp", rects, "c", box(120, 131))!.y + 131 / 2).toBe(90);
  });
  it("moves down and stops at the ends", () => {
    expect(neighbourCoordinates("ArrowDown", rects, "a", box(0, 60))!.y).toBe(60);
    expect(neighbourCoordinates("ArrowDown", rects, "c", box(120, 131))).toBeNull();
    expect(neighbourCoordinates("ArrowUp", rects, "a", box(0, 60))).toBeNull();
  });
});
