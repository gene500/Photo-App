import { useSyncExternalStore } from "react";

/**
 * Phone held sideways: wide but short. Below lg (so desktop windows keep the left card) and at most 500px tall,
 * the trip panel becomes a side panel instead of a bottom sheet. Keep in sync with `@custom-variant short-landscape`
 * in app/globals.css (Tailwind cannot read this constant).
 */
export const SHORT_LANDSCAPE_QUERY = "(orientation: landscape) and (max-height: 500px) and (max-width: 1023px)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(SHORT_LANDSCAPE_QUERY);
  mq.addEventListener?.("change", onChange);
  return () => mq.removeEventListener?.("change", onChange);
}

export function isShortLandscape(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(SHORT_LANDSCAPE_QUERY).matches;
}

/** Whether the viewport is a short landscape one now; false on the server and for the first client render. */
export function useShortLandscape(): boolean {
  return useSyncExternalStore(subscribe, isShortLandscape, () => false);
}

/** The side panel's width in px for a page `pageWidth` px wide (40% of the page, clamped to 17.5rem..23.75rem like the `short-landscape:w-[clamp(...)]` classes, with rem scaled by the text-size setting). */
export function sidePanelPx(pageWidth: number, scale = 1): number {
  return Math.round(Math.min(Math.max(pageWidth * 0.4, 17.5 * 16 * scale), 23.75 * 16 * scale));
}

/** Map fit padding for short landscape: the points are centred in the map to the right of the side panel. */
export function sideViewPadding(pageWidth: number, scale = 1): { top: number; right: number; bottom: number; left: number } {
  return { top: 64, right: 24, bottom: 24, left: sidePanelPx(pageWidth, scale) + 16 };
}
