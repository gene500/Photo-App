import { describe, expect, it } from "vitest";
import { PDF_BORDER, PDF_RULE, PDF_THEME, blend, contrastRatio, hexToRgb, markerTextColor, rgbToHex, safeStopColor } from "./pdf-theme";
import { STOP_COLORS } from "./stop-style";

describe("pdf theme", () => {
  it("matches the app's light tokens", () => {
    expect(PDF_THEME.paper).toBe("#f7f3e9");
    expect(PDF_THEME.foreground).toBe("#1f1b14");
    expect(PDF_THEME.muted).toBe("#655e4f");
    expect(PDF_THEME.accentStrong).toBe("#6f5a2c");
    expect(PDF_THEME.sand).toBe("#7a5f2a");
    expect(PDF_THEME.route).toBe("#a8834b");
  });

  it("converts hex and blends the translucent border onto paper", () => {
    expect(hexToRgb("#ff8000")).toEqual([255, 128, 0]);
    expect(hexToRgb("nope")).toEqual([0, 0, 0]);
    expect(rgbToHex([255, 128, 0])).toBe("#ff8000");
    expect(blend([0, 0, 0], 0.5, [200, 100, 50])).toEqual([100, 50, 25]);
    const [r] = PDF_BORDER;
    expect(r).toBeLessThan(247);
    expect(r).toBeGreaterThan(200);
    expect(PDF_RULE[0]).toBeLessThan(PDF_BORDER[0]);
  });

  it("keeps every text colour readable on the paper (WCAG AA 4.5:1, so also in greyscale)", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    for (const c of [PDF_THEME.foreground, PDF_THEME.muted, PDF_THEME.accentStrong, PDF_THEME.sand]) {
      expect(contrastRatio(c, PDF_THEME.paper)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("picks a number colour that reads on every stop colour", () => {
    for (const fill of Object.values(STOP_COLORS)) {
      expect(contrastRatio(markerTextColor(fill), fill)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("defaults a missing or malformed stop colour to the manual stop colour", () => {
    expect(safeStopColor(undefined)).toBe(STOP_COLORS.manual);
    expect(safeStopColor("red")).toBe(STOP_COLORS.manual);
    expect(safeStopColor("#b4572f")).toBe("#b4572f");
  });
});
