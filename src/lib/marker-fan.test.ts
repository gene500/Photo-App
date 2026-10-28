import { describe, expect, it } from "vitest";
import { fanOffsets, MARKER_PX } from "./marker-fan";

const at = (id: string, x: number, y: number) => ({ id, x, y });
const shown = (pts: { id: string; x: number; y: number }[]) => {
  const o = fanOffsets(pts);
  return pts.map((p) => ({ x: p.x + (o.get(p.id)?.dx ?? 0), y: p.y + (o.get(p.id)?.dy ?? 0) }));
};
const minGap = (pts: { x: number; y: number }[]) =>
  Math.min(...pts.flatMap((a, i) => pts.slice(i + 1).map((b) => Math.hypot(a.x - b.x, a.y - b.y))));

describe("fanOffsets", () => {
  it("separates two stops at identical coordinates", () => {
    const pts = [at("a", 100, 100), at("b", 100, 100)];
    expect(fanOffsets(pts).size).toBe(2);
    expect(minGap(shown(pts))).toBeGreaterThanOrEqual(MARKER_PX);
  });

  it("fans three stacked stops so none overlap, around the shared point", () => {
    const pts = [at("a", 50, 50), at("b", 50, 50), at("c", 50, 50)];
    const s = shown(pts);
    expect(minGap(s)).toBeGreaterThanOrEqual(MARKER_PX);
    expect(s.reduce((t, p) => t + p.x, 0) / 3).toBeCloseTo(50);
    expect(s.reduce((t, p) => t + p.y, 0) / 3).toBeCloseTo(50);
  });

  it("spreads nearly-identical but overlapping stops", () => {
    const pts = [at("a", 100, 100), at("b", 105, 103)];
    expect(minGap(shown(pts))).toBeGreaterThanOrEqual(MARKER_PX);
  });

  it("leaves stops that do not overlap alone", () => {
    expect(fanOffsets([at("a", 0, 0), at("b", MARKER_PX, 0), at("c", 500, 500)]).size).toBe(0);
  });

  it("only moves the overlapping group", () => {
    const o = fanOffsets([at("a", 10, 10), at("b", 10, 10), at("far", 400, 400)]);
    expect(o.has("far")).toBe(false);
    expect(o.size).toBe(2);
  });

  it("depends on zoom: stacked when zoomed out, apart when zoomed in", () => {
    const at10 = (scale: number) => [at("a", 0, 0), at("b", 10 * scale, 0)];
    expect(fanOffsets(at10(1)).size).toBe(2);
    expect(fanOffsets(at10(8)).size).toBe(0);
  });

  it("is deterministic and handles empty / single input", () => {
    expect(fanOffsets([]).size).toBe(0);
    expect(fanOffsets([at("a", 1, 1)]).size).toBe(0);
    const pts = [at("a", 5, 5), at("b", 5, 5)];
    expect(fanOffsets(pts)).toEqual(fanOffsets(pts));
  });
});
