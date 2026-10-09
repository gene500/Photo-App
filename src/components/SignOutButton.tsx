"use client";

import { signOut } from "next-auth/react";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { clearAllCopies, disableOfflineSaving } from "@/lib/offline-store";

/** Signing out on a shared device must not leave this user's trips behind (see below). */
export function SignOutEverywhereButton({ className }: { className?: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setPending(true);
    setError(null);
    try {
      await api.signOutEverywhere();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't sign out everywhere");
      setPending(false);
      return;
    }
    disableOfflineSaving();
    clearAllCopies();
    void signOut({ callbackUrl: "/login" });
  }
  return (
    <div className="space-y-2">
      <button type="button" disabled={pending} onClick={() => void run()} className={className}>
        Sign out on all devices
      </button>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}

export function SignOutButton() {
  return (
    <button type="button" onClick={() => {
        // A shared device must not keep this user's trips. Saving is switched off first so a pending
        // autosave cannot bring a copy back while the async sign-out is in flight.
        disableOfflineSaving();
        clearAllCopies();
        void signOut({ callbackUrl: "/login" });
      }} className="inline-flex min-h-9 items-center rounded-lg px-3 text-sm text-muted transition hover:bg-hover hover:text-foreground">
      Sign out
    </button>
  );
}
