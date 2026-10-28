import { describe, expect, it } from "vitest";
import { FLOW_SWEEP_MS, FLOW_TOTAL_MS, easeInOutSine, flowFrame, flowGradientExpression, flowGradientStops, hiddenRange } from "./route-flow";

describe("easeInOutSine", () => {
  it("runs 0 to 1, slowly at the ends, and clamps", () => {
    expect(easeInOutSine(0)).toBe(0);
    expect(easeInOutSine(1)).toBe(1);
    expect(easeInOutSine(0.5)).toBeCloseTo(0.5);
    expect(easeInOutSine(0.1)).toBeLessThan(0.1);
    expect(easeInOutSine(-3)).toBe(0);
    expect(easeInOutSine(9)).toBe(1);
  });
});

describe("flowFrame", () => {
  it("starts before the first stop at full opacity and is not done", () => {
    const f = flowFrame(0);
    expect(f.head).toBeLessThan(0);
    expect(f).toMatchObject({ opacity: 1, done: false });
  });
  it("moves the head forward monotonically through the sweep", () => {
    let prev = -Infinity;
    for (let t = 0; t <= FLOW_SWEEP_MS; t += 100) {
      const { head } = flowFrame(t);
      expect(head).toBeGreaterThanOrEqual(prev);
      prev = head;
    }
    expect(prev).toBeGreaterThan(1);
  });
  it("fades out after the sweep and finishes at the total", () => {
    expect(flowFrame(FLOW_SWEEP_MS).opacity).toBe(1);
    const mid = flowFrame(FLOW_SWEEP_MS + (FLOW_TOTAL_MS - FLOW_SWEEP_MS) / 2);
    expect(mid.opacity).toBeGreaterThan(0);
    expect(mid.opacity).toBeLessThan(1);
    expect(flowFrame(FLOW_TOTAL_MS)).toMatchObject({ opacity: 0, done: true });
    expect(flowFrame(FLOW_TOTAL_MS * 5).done).toBe(true);
  });
  it("treats NaN and negative time as the start", () => {
    expect(flowFrame(NaN).head).toBe(flowFrame(0).head);
    expect(flowFrame(-50).head).toBe(flowFrame(0).head);
  });
});

describe("flowGradientStops", () => {
  const valid = (stops: [number, string][]) => {
    expect(stops.length).toBeGreaterThanOrEqual(2);
    expect(stops[0]![0]).toBe(0);
    expect(stops[stops.length - 1]![0]).toBe(1);
    for (let i = 1; i < stops.length; i++) expect(stops[i]![0]).toBeGreaterThan(stops[i - 1]![0]);
  };
  it("is strictly increasing within 0..1 for every head position, including off both ends", () => {
    for (let h = -0.2; h <= 1.2; h += 0.0137) valid(flowGradientStops(h));
    for (const h of [-0.07, 0, 0.0001, 0.03, 0.06, 0.5, 0.94, 0.97, 1, 1.07]) valid(flowGradientStops(h));
  });
  it("is clear everywhere before the head enters and after it has left", () => {
    expect(flowGradientStops(-0.07).every(([, c]) => /, 0\)$/.test(c))).toBe(true);
    expect(flowGradientStops(1.2).every(([, c]) => /, 0\)$/.test(c))).toBe(true);
  });
  it("has a bright head with a short glow behind it and clear line elsewhere mid-sweep", () => {
    const s = flowGradientStops(0.5);
    expect(s[0]![1]).toMatch(/, 0\)$/);
    expect(s[s.length - 1]![1]).toMatch(/, 0\)$/);
    expect(s.some(([t, c]) => t === 0.5 && /0\.98\)$/.test(c))).toBe(true);
    expect(s.filter(([, c]) => !/, 0\)$/.test(c)).length).toBeLessThanOrEqual(2);
  });
  it("builds the Mapbox expression", () => {
    const e = flowGradientExpression(0.5);
    expect(e.slice(0, 3)).toEqual(["interpolate", ["linear"], ["line-progress"]]);
    expect((e.length - 3) % 2).toBe(0);
  });
});

describe("hiddenRange", () => {
  it("hides everything before the head arrives, less as it moves, and nothing once it has left", () => {
    expect(hiddenRange(-0.07)).toEqual([0, 1]);
    expect(hiddenRange(0.4)).toEqual([0.4, 1]);
    expect(hiddenRange(1.07)).toEqual([1, 1]);
  });
});
