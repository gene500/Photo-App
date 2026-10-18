"use client";

import { type ReactNode, useCallback, useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { btnDanger, btnSecondary } from "./styles";

export type ConfirmOptions = { title: string; message: string; confirmLabel: string };

type Pending = { opts: ConfirmOptions; resolve: (ok: boolean) => void };

/** Themed replacement for window.confirm: `await confirm(...)` resolves true on the confirm button, false otherwise. */
export function useConfirm(): { confirm: (o: ConfirmOptions) => Promise<boolean>; dialog: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);
  const current = useRef<Pending | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const settle = useCallback((ok: boolean) => {
    const p = current.current;
    if (!p) return;
    current.current = null;
    setPending(null);
    p.resolve(ok);
  }, []);

  const confirm = useCallback((opts: ConfirmOptions) => {
    // Only one dialog at a time: a newer request cancels the one still open.
    current.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      const p = { opts, resolve };
      current.current = p;
      setPending(p);
    });
  }, []);

  const dialog = (
    <Dialog open={pending !== null} title={pending?.opts.title ?? ""} description={pending?.opts.message} onCancel={() => settle(false)} initialFocusRef={cancelRef}>
      <button ref={cancelRef} type="button" className={btnSecondary} onClick={() => settle(false)}>Cancel</button>
      <button type="button" className={btnDanger} onClick={() => settle(true)}>{pending?.opts.confirmLabel}</button>
    </Dialog>
  );
  return { confirm, dialog };
}
