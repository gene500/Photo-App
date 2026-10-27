export type PopoverFitInput = {
  triggerTop: number;
  triggerBottom: number;
  /** The panel's natural height. */
  height: number;
  /** The visible area the panel may use: the window, narrowed by the nearest ancestor that clips it. */
  boundsTop: number;
  boundsBottom: number;
};

const GAP = 4;
const MARGIN = 12;
const MIN_HEIGHT = 48;

/** Where a popover goes relative to its trigger: below if it fits, else whichever side has more room (capped, scrolling inside). */
export function fitPopover(i: PopoverFitInput): { placement: "below" | "above"; maxHeight: number | null } {
  const below = i.boundsBottom - (i.triggerBottom + GAP) - MARGIN;
  if (i.height <= below) return { placement: "below", maxHeight: null };
  const above = i.triggerTop - GAP - Math.max(i.boundsTop, 0) - MARGIN;
  if (above > below) return { placement: "above", maxHeight: Math.min(i.height, above) };
  return { placement: "below", maxHeight: Math.max(below, MIN_HEIGHT) };
}
