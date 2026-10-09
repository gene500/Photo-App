"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useEffect, useState } from "react";
import { clearAllCopies, enableOfflineSaving } from "@/lib/offline-store";
import { btnPrimary, inputClass } from "@/components/ui/styles";


export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Nobody is signed in on this page, so no offline copy should be on the device (belt and braces for sign-out).
  useEffect(() => clearAllCopies(), []);

  async function submit() {
    setPending(true);
    setError(null);
    const res = await signIn("credentials", { email, password, redirect: false });
    setPending(false);
    if (!res || res.error) {
      setError(res?.error === "RateLimited" ? "Too many login attempts. Try again in a few minutes." : "Invalid email or password");
      return;
    }
    enableOfflineSaving();
    router.push("/trips");
    router.refresh();
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="mx-auto mt-[12vh] w-full max-w-sm space-y-4 rounded-2xl bg-surface p-7 shadow-lg ring-1 ring-border">
      <h1 className="text-2xl font-semibold">Log in</h1>
      <label className="block">
        <span className="text-sm text-muted">Email</span>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
      </label>
      <label className="block">
        <span className="text-sm text-muted">Password</span>
        <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
      </label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button type="submit" disabled={pending} className={`${btnPrimary} w-full`}>
        Log in
      </button>
      <p className="text-sm text-muted">
        No account? <Link href="/signup" className="font-medium text-foreground underline underline-offset-2">Sign up</Link>
      </p>
    </form>
  );
}
