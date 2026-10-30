// Colours of the downloadable itinerary PDF: the app's LIGHT theme tokens (src/app/globals.css) so the file matches the screen.

import { STOP_COLORS } from "./stop-style";

export type Rgb = [number, number, number];

/** Light-theme tokens from globals.css. Paper is --surface; --border is rgb(61 48 25 / 0.13), pre-blended onto paper below. */
export const PDF_THEME = {
  paper: "#f7f3e9",
  /** --background: the map placeholder and image frame backdrop. */
  backdrop: "#ece6d8",
  foreground: "#1f1b14",
  muted: "#655e4f",
  accent: "#d4bd8f",
  accentStrong: "#6f5a2c",
  accentSoft: "#e6d9bb",
  sand: "#7a5f2a",
  route: "#a8834b",
  white: "#ffffff",
} as const;

export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/** Colour of `fg` at `alpha` drawn over the opaque `bg`. */
export function blend(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return [0, 1, 2].map((i) => fg[i] * alpha + bg[i] * (1 - alpha)) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG 2 contrast ratio, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(hexToRgb(a)), luminance(hexToRgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Divider and frame colour: the app's translucent border over the paper. */
export const PDF_BORDER: Rgb = blend([61, 48, 25], 0.13, hexToRgb(PDF_THEME.paper));
/** A little stronger than PDF_BORDER so thin rules still print. */
export const PDF_RULE: Rgb = blend([61, 48, 25], 0.28, hexToRgb(PDF_THEME.paper));

/** Number colour on a stop disc: white when it reads at 4.5:1, else the dark foreground. */
export function markerTextColor(fill: string): string {
  return contrastRatio(PDF_THEME.white, fill) >= 4.5 ? PDF_THEME.white : PDF_THEME.foreground;
}

/** Stop disc colour with a safe default (a stop whose colour is missing or malformed is drawn as a manual stop). */
export function safeStopColor(color: string | undefined | null): string {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : STOP_COLORS.manual;
}
