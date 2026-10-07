"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button type="button" onClick={() => void signOut({ callbackUrl: "/login" })} className="inline-flex min-h-9 items-center rounded-lg px-3 text-sm text-muted transition hover:bg-hover hover:text-foreground">
      Sign out
    </button>
  );
}
