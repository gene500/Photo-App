"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { fitPopover } from "./popover-fit";

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled])';

/**
 * Extra classes for a header popover panel on short screens (phone landscape): the bottom sheet is only ~175 px tall and
 * clips its children, so the panel leaves the sheet (fixed to the top right of the window) and scrolls if it is still too tall.
 */
export const SHORT_SCREEN_POPOVER = "[@media(max-height:30rem)]:fixed [@media(max-height:30rem)]:right-3 [@media(max-height:30rem)]:top-3 [@media(max-height:30rem)]:mt-0 [@media(max-height:30rem)]:max-h-[calc(100dvh-1.5rem)] [@media(max-height:30rem)]:overflow-y-auto";

/**
 * Plain disclosure behaviour for a header popover: Escape and an outside press close it, focus moves into the
 * panel on open and goes back to the trigger when it closes by keyboard or by choosing something inside it.
 * (An outside press leaves focus wherever the user clicked.)
 */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);
  const toggle = useCallback(() => setOpen((o) => !o), []);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    // preventScroll: focusing must not scroll the sheet before the panel is fitted to the window.
    (panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel)?.focus({ preventScroll: true });
    // Keep a tall panel on screen: cap it to the room left below its top edge and scroll inside (the fixed short-screen layout does this in CSS).
    function fit() {
      if (!panel) return;
      if (getComputedStyle(panel).position === "fixed") {
        panel.style.maxHeight = "";
        panel.style.top = "";
        panel.style.marginTop = "";
        return;
      }
      panel.style.maxHeight = "";
      panel.style.top = "";
      panel.style.marginTop = "";
      // Layout numbers only (offsetHeight, the trigger's rect): the panel's own rect moves while its entrance animation runs.
      // The panel hangs off its offset parent (the trigger's wrapper, which can be taller than the button), so that is the anchor.
      const parent = panel.offsetParent?.getBoundingClientRect();
      const trigger = parent ?? triggerRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const height = panel.offsetHeight;
      // The panel can only be seen inside the window AND inside the nearest ancestor that clips it (the bottom sheet).
      let boundsTop = 0;
      let boundsBottom = window.innerHeight;
      for (let el = panel.parentElement; el && el !== document.body; el = el.parentElement) {
        const cs = getComputedStyle(el);
        if (/(hidden|clip|auto|scroll)/.test(cs.overflowY)) {
          const r = el.getBoundingClientRect();
          boundsTop = Math.max(boundsTop, r.top);
          boundsBottom = Math.min(boundsBottom, r.bottom);
        }
      }
      const spot = fitPopover({ triggerTop: trigger.top, triggerBottom: trigger.bottom, height, boundsTop, boundsBottom });
      if (spot.maxHeight === null) return; // fits under the button
      panel.style.maxHeight = `${spot.maxHeight}px`;
      if (spot.placement === "above") {
        // Open upward, bottom edge just over the button.
        panel.style.marginTop = "0";
        panel.style.top = `${trigger.top - 4 - spot.maxHeight - (parent?.top ?? 0)}px`;
      }
      panel.style.overflowY = "auto";
    }
    fit();
    const frame = requestAnimationFrame(fit); // once the entrance animation and layout have settled
    window.addEventListener("resize", fit);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close(true);
    }
    function onPress(e: Event) {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) close(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", fit);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress);
    };
  }, [open, close]);

  return { open, setOpen, close, toggle, rootRef, triggerRef, panelRef, panelId };
}
