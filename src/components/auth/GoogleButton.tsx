"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { btnSecondary } from "@/components/ui/styles";

/** "Continue with Google" with an "or" divider; the page only renders it when Google sign-in is configured. */
export function GoogleButton() {
  const [pending, setPending] = useState(false);
  return (
    <div className="space-y-3">
      <button type="button" disabled={pending} onClick={() => { setPending(true); void signIn("google", { callbackUrl: "/trips" }); }} className={`${btnSecondary} w-full`}>
        {pending ? "Opening Google…" : "Continue with Google"}
      </button>
      <p aria-hidden className="flex items-center gap-3 text-xs text-muted before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">or</p>
    </div>
  );
}

/** Plain-language text for the ?error= values the sign-in flow can send back to /login. */
export function loginErrorMessage(code: string | null): string | null {
  switch (code) {
    case null:
    case "":
      return null;
    case "GoogleEmailInUse":
      return "An account with that email already exists. Log in with your password.";
    case "GoogleUnverified":
      return "Google did not confirm that email address, so it can't be used to sign in.";
    case "RateLimited":
      return "Too many login attempts. Try again in a few minutes.";
    default:
      return "Sign-in failed. Please try again.";
  }
}
