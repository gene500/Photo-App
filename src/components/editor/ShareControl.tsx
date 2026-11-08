"use client";

import { useEffect, useRef, useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { HeaderButtonLabel } from "./HeaderButtonLabel";
import { btnGhost, btnPrimary, btnSecondary, card, inputClass } from "@/components/ui/styles";
import { api } from "@/lib/api-client";
import { SHORT_SCREEN_POPOVER, usePopover } from "./use-popover";

type Props = {
  tripId: string;
  shareToken: string | null;
  /** Called with the new token, or null once the link is revoked. */
  onChange: (shareToken: string | null) => void;
};

/** "Share" button with a small panel to create, copy and revoke the read-only link. */
export function ShareControl({ tripId, shareToken, onChange }: Props) {
  const { open, toggle, rootRef, triggerRef, panelRef, panelId } = usePopover();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);
  const createRef = useRef<HTMLButtonElement>(null);
  const hadToken = useRef(shareToken !== null);
  // The button that was pressed is replaced when the link is created or revoked: hand focus to its successor.
  useEffect(() => {
    const has = shareToken !== null;
    if (has !== hadToken.current && open) (has ? linkRef : createRef).current?.focus();
    hadToken.current = has;
  }, [shareToken, open]);

  const url = shareToken && typeof window !== "undefined" ? `${window.location.origin}/s/${shareToken}` : "";

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  const create = () => run(async () => onChange((await api.createShare(tripId)).shareToken), "Couldn't create the link");
  const revoke = () =>
    run(async () => {
      await api.revokeShare(tripId);
      setCopied(false);
      setConfirmRevoke(false);
      onChange(null);
    }, "Couldn't revoke the link");

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError("Couldn't copy. Select the link and copy it manually.");
    }
  }

  return (
    <div ref={rootRef} className="shrink-0">
      <button ref={triggerRef} type="button" onClick={toggle} aria-expanded={open} aria-controls={open ? panelId : undefined} aria-label="Share" title="Share" className={btnGhost}>
        <HeaderButtonLabel icon="share">Share</HeaderButtonLabel>
      </button>
      {open && (
        <div ref={panelRef} id={panelId} role="group" aria-label="Share trip" className={`absolute right-0 top-full z-20 mt-1 w-72 max-w-full space-y-2 p-3 ${SHORT_SCREEN_POPOVER} ${card}`}>
          <p className="text-sm text-muted">Anyone with the link can see this trip: trip name, stop names and locations, times, and each stop&apos;s shot notes and shot checklist. Stop photos and the notes you write in each stop&apos;s Notes field are not shown.</p>
          {shareToken ? (
            <>
              <input ref={linkRef} readOnly aria-label="Share link" value={url} onFocus={(e) => e.currentTarget.select()} className={`${inputClass} !mt-0 text-xs`} />
              {confirmRevoke && <p className="text-xs text-muted">Revoking stops the link working for everyone who has it.</p>}
              <div className="flex gap-2">
                <button type="button" onClick={() => void copy()} className={btnSecondary}>{copied ? "Copied" : "Copy link"}</button>
                {confirmRevoke ? (
                  <>
                    <button type="button" onClick={() => { if (!busy) void revoke(); }} aria-disabled={busy || undefined} className={`${btnGhost} aria-disabled:cursor-not-allowed aria-disabled:opacity-50`}>Yes, revoke</button>
                    <button type="button" onClick={() => setConfirmRevoke(false)} className={btnGhost}>Keep</button>
                  </>
                ) : (
                  <button type="button" onClick={() => setConfirmRevoke(true)} disabled={busy} className={btnGhost}>Revoke link</button>
                )}
              </div>
            </>
          ) : (
            <button ref={createRef} type="button" onClick={() => void create()} disabled={busy} className={btnPrimary}>Create link</button>
          )}
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        </div>
      )}
    </div>
  );
}
