"use client";

import Link from "next/link";
import { LegalLinks } from "@/components/legal/LegalPage";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { softDisabled } from "@/lib/focus";
import { clearAllCopies, enableOfflineSaving } from "@/lib/offline-store";
import { btnPrimary, inputClass } from "@/components/ui/styles";
import { GoogleButton, loginErrorMessage } from "./GoogleButton";
import { signInWithCredentials } from "./credentials-login";


export function LoginForm({ google = false, urlError = null }: { google?: boolean; urlError?: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(loginErrorMessage(urlError));
  const [pending, setPending] = useState(false);
  // Nobody is signed in on this page, so no offline copy should be on the device (belt and braces for sign-out).
  useEffect(() => clearAllCopies(), []);

  async function submit() {
    if (pending) return;
    setPending(true);
    setError(null);
    if (!navigator.onLine) {
      setPending(false);
      setError("You're offline. Connect to the internet to log in.");
      return;
    }
    const outcome = await signInWithCredentials(email, password);
    setPending(false);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    enableOfflineSaving();
    router.push("/trips");
    router.refresh();
  }

  return (
    <form method="post" onSubmit={(e) => { e.preventDefault(); void submit(); }} className="mx-auto mt-[12vh] w-full max-w-sm space-y-4 rounded-2xl bg-surface p-7 shadow-lg ring-1 ring-border">
      <h1 className="text-2xl font-semibold">Log in</h1>
      {google && <GoogleButton />}
      <label className="block">
        <span className="text-sm text-muted">Email</span>
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
      </label>
      <label className="block">
        <span className="text-sm text-muted">Password</span>
        <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
      </label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button type="submit" {...softDisabled(pending)} className={`${btnPrimary} w-full`}>
        Log in
      </button>
      <p className="text-sm text-muted">
        No account? <Link href="/signup" className="font-medium text-foreground underline underline-offset-2">Sign up</Link>
      </p>
      <LegalLinks />
    </form>
  );
}
