import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("forced colors (Windows high contrast)", () => {
  const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
  const block = css.slice(css.indexOf("@media (forced-colors: active)"));
  it("gives ring-only surfaces a real border", () => {
    expect(block).toMatch(/\.ring-1\s*{\s*border:\s*1px solid CanvasText/);
  });
  it("marks the selected tab with the system highlight colours", () => {
    expect(block).toMatch(/\[role="tab"\]\[aria-selected="true"\][^}]*Highlight/);
  });
});

describe("browsers without :has()", () => {
  const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
  it("falls back to a definite height for the editor main", () => {
    expect(css).toMatch(/@supports not selector\(:has\(\*\)\)\s*{\s*main\[data-fill\]\s*{\s*height:\s*calc\(100dvh - 3\.25rem\)/);
  });
  it("is the only place the fallback is needed: the layout still uses has-[main[data-fill]]", () => {
    expect(readFileSync(new URL("./trips/layout.tsx", import.meta.url), "utf8")).toContain("has-[main[data-fill]]:h-dvh");
  });
});
