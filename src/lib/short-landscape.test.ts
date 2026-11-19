import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SHORT_LANDSCAPE_QUERY, sidePanelPx, sideViewPadding } from "./short-landscape";

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

describe("short landscape query", () => {
  it("needs a phone-landscape width, so a portrait phone whose on-screen keyboard shrinks the page is not taken for landscape (QA P3-001)", () => {
    expect(SHORT_LANDSCAPE_QUERY).toContain("(min-width: 480px)");
  });
  it("is the same query as the Tailwind variant in globals.css", () => {
    const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toContain(`@custom-variant short-landscape (@media ${SHORT_LANDSCAPE_QUERY});`);
  });
});
