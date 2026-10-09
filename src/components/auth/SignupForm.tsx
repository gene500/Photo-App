"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { enableOfflineSaving } from "@/lib/offline-store";
import { btnPrimary, inputClass } from "@/components/ui/styles";
import { api } from "@/lib/api-client";


/** `formToken` is signed by the server when the page renders (see signup-guard.ts); `website` is a honeypot. */
export function SignupForm({ formToken }: { formToken?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [website, setWebsite] = useState("");
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      await api.signup(email, password, { formToken, website });
      const res = await signIn("credentials", { email, password, redirect: false });
      if (!res || res.error) throw new Error("Account created, but signing in failed. Try logging in.");
      enableOfflineSaving();
      router.push("/trips");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign up failed");
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="mx-auto mt-[12vh] w-full max-w-sm space-y-4 rounded-2xl bg-surface p-7 shadow-lg ring-1 ring-border">
      <h1 className="text-2xl font-semibold">Create an account</h1>
      <label className="block">
        <span className="text-sm text-muted">Email</span>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
      </label>
      <label className="block">
        <span className="text-sm text-muted">Password</span>
        <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
      </label>
      <p className="text-xs text-muted">At least 8 characters.</p>
      {/* Honeypot: invisible to people and assistive tech, tempting to bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button type="submit" disabled={pending} className={`${btnPrimary} w-full`}>
        Create account
      </button>
      <p className="text-sm text-muted">
        Have an account? <Link href="/login" className="font-medium text-foreground underline underline-offset-2">Log in</Link>
      </p>
    </form>
  );
}
