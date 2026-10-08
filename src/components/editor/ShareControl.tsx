"use client";

import { useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { btnGhost, btnPrimary, btnSecondary, card, inputClass } from "@/components/ui/styles";
import { api } from "@/lib/api-client";
import { usePopover } from "./use-popover";

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
      <button ref={triggerRef} type="button" onClick={toggle} aria-expanded={open} aria-controls={open ? panelId : undefined} className={btnGhost}>
        Share
      </button>
      {open && (
        <div ref={panelRef} id={panelId} role="group" aria-label="Share trip" className={`absolute right-0 top-full z-20 mt-1 w-72 max-w-full space-y-2 p-3 ${card}`}>
          <p className="text-sm text-muted">Anyone with the link can view this trip (without photos).</p>
          {shareToken ? (
            <>
              <input readOnly aria-label="Share link" value={url} onFocus={(e) => e.currentTarget.select()} className={`${inputClass} !mt-0 text-xs`} />
              <div className="flex gap-2">
                <button type="button" onClick={() => void copy()} className={btnSecondary}>{copied ? "Copied" : "Copy link"}</button>
                <button type="button" onClick={() => void revoke()} disabled={busy} className={btnGhost}>Revoke link</button>
              </div>
            </>
          ) : (
            <button type="button" onClick={() => void create()} disabled={busy} className={btnPrimary}>Create link</button>
          )}
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        </div>
      )}
    </div>
  );
}
