"use client";

import { signOut } from "next-auth/react";
import { clearAllCopies, disableOfflineSaving } from "@/lib/offline-store";

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
