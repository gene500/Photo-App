/**
 * True for pointers that can really hover (mouse, pen). Touch is excluded, and so is any device whose primary
 * input cannot hover: on iOS, DOM changes made from a hover handler make WebKit swallow the tap's click, so the
 * first tap would only show the popup.
 */
export function isHoverPointer(e: { pointerType?: string }): boolean {
  if (e.pointerType === "touch") return false;
  try {
    if (typeof window !== "undefined" && window.matchMedia?.("(hover: none)").matches) return false;
  } catch {
    /* no matchMedia: assume hover works */
  }
  return true;
}
