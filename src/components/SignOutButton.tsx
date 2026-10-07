"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button type="button" onClick={() => void signOut({ callbackUrl: "/login" })} className="text-sm underline">
      Sign out
    </button>
  );
}
