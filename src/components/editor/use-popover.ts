"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

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
    (panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel)?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close(true);
    }
    function onPress(e: Event) {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) close(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress);
    };
  }, [open, close]);

  return { open, setOpen, close, toggle, rootRef, triggerRef, panelRef, panelId };
}
