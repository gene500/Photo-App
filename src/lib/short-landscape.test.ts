import { describe, expect, it } from "vitest";
import { sidePanelPx, sideViewPadding } from "./short-landscape";

describe("short landscape side panel", () => {
  it("is 40% of the page, clamped to 280-380px", () => {
    expect(sidePanelPx(667)).toBe(280); // 40% = 267 -> min
    expect(sidePanelPx(844)).toBe(338);
    expect(sidePanelPx(1000)).toBe(380); // 400 -> max
  });
  it("scales the limits with the text size", () => {
    expect(sidePanelPx(667, 2)).toBe(560);
    expect(sidePanelPx(1000, 1.5)).toBe(420);
  });
  it("pads the map by the panel width so points centre in the visible map", () => {
    expect(sideViewPadding(844)).toEqual({ top: 64, right: 24, bottom: 24, left: 354 });
  });
});
