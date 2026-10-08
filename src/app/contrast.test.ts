import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/app/globals.css", "utf8");

/** Token values from the first block that follows `selector` (light = :root, dark = the explicit data-theme block). */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const lum = ([r, g, b]: [number, number, number]) => {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: [number, number, number], b: [number, number, number]) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** Resolves a token to a solid colour; rgb(r g b / a) overlays are blended onto `under`. */
function solid(value: string, under: [number, number, number]): [number, number, number] {
  const m = value.match(/rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/);
  if (!m) return rgb(value);
  const a = Number(m[4]);
  return [1, 2, 3].map((i) => Math.round(Number(m[i]) * a + under[i - 1] * (1 - a))) as [number, number, number];
}

// Text token on the surface token it is actually drawn on.
const PAIRS: [string, string][] = [
  ["foreground", "background"], ["foreground", "surface"], ["muted", "background"], ["muted", "surface"], ["muted", "hover"],
  ["muted", "accent-soft"], ["accent-strong", "surface"], ["accent-strong", "background"], ["accent-strong", "accent-soft"],
  ["accent-foreground", "accent"], ["ink-foreground", "ink"], ["danger", "surface"], ["danger", "danger-soft"],
];

describe.each([
  ["light", ":root {"],
  ["dark", ':root[data-theme="dark"]'],
])("%s theme text contrast", (_name, selector) => {
  const t = tokens(selector);
  it.each(PAIRS)("%s on %s is at least 4.5:1", (fg, bg) => {
    const under = rgb(t.surface);
    expect(ratio(solid(t[fg], under), solid(t[bg], under))).toBeGreaterThanOrEqual(4.5);
  });
});
