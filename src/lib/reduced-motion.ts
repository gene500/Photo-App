/** Whether animations should be skipped: the device asks for less motion, or the app's own "Reduce motion" setting is on (it sets data-reduce-motion on <html>). */
export function motionReduced(): boolean {
  if (typeof window === "undefined") return false;
  if (document.documentElement.dataset.reduceMotion === "true") return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
