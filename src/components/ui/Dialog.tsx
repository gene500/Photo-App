"use client";

import { type ReactNode, type RefObject, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { card } from "./styles";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Props = {
  open: boolean;
  role?: "dialog" | "alertdialog";
  title: string;
  description?: ReactNode;
  /** Escape and a press on the backdrop. */
  onCancel: () => void;
  /** Gets focus on open; otherwise the first focusable element. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  busy?: boolean;
  /** Backdrop presses this soon after opening are ignored (the tail of a double-click on the opener). */
  backdropGraceMs?: number;
  /** The action row. */
  children: ReactNode;
};

/** Modal card over a dimmed backdrop: focus trap, Escape, focus restored to the opener on close. */
export function Dialog({ open, role = "alertdialog", title, description, onCancel, initialFocusRef, busy, backdropGraceMs = 0, children }: Props) {
  const titleId = useId();
  const descId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  // Read through refs so the effects below depend only on `open`.
  const cancelRef = useRef(onCancel);
  const initialRef = useRef(initialFocusRef);
  useEffect(() => {
    cancelRef.current = onCancel;
    initialRef.current = initialFocusRef;
  });
  const pressedBackdrop = useRef(false);
  const openedAt = useRef(0);

  useEffect(() => {
    if (!open) return;
    openedAt.current = Date.now();
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = initialRef.current?.current ?? cardRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? cardRef.current;
    first?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // Capture phase, and stopped here: Escape closes only this dialog, not the popover, drawer or search box under it.
        e.preventDefault();
        e.stopPropagation();
        cancelRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      // Keep Tab inside the card (aria-modal): wrap at either end.
      const items = Array.from(cardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      const firstItem = items[0];
      const last = items[items.length - 1];
      if (!firstItem || !last) return;
      const active = document.activeElement;
      if (!cardRef.current?.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : firstItem).focus();
      } else if (e.shiftKey && active === firstItem) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        firstItem.focus();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (opener && opener.isConnected) opener.focus();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div
      data-testid="dialog-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      // Only a press that starts and ends on the backdrop cancels, not a drag that ends there.
      onPointerDown={(e) => { pressedBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        // A press within the first moments is the tail of a double-click on the button that opened the dialog, not a dismissal.
        if (e.target === e.currentTarget && pressedBackdrop.current && (backdropGraceMs === 0 || Date.now() - openedAt.current > backdropGraceMs)) onCancel();
        pressedBackdrop.current = false;
      }}
    >
      <div
        ref={cardRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        aria-busy={busy || undefined}
        tabIndex={-1}
        className={`${card} w-full max-w-sm p-5`}
      >
        <h2 id={titleId} className="text-base font-semibold">{title}</h2>
        {description && <p id={descId} className="mt-2 text-sm text-muted">{description}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
