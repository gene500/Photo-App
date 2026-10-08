"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled])';

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
