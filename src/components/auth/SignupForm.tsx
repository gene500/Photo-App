"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { api } from "@/lib/api-client";

const inputClass = "mt-1 w-full rounded border px-2 py-1";

export function SignupForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      await api.signup(email, password);
      const res = await signIn("credentials", { email, password, redirect: false });
      if (!res || res.error) throw new Error("Account created, but signing in failed. Try logging in.");
      router.push("/trips");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign up failed");
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="mx-auto mt-16 w-full max-w-sm space-y-4">
      <h1 className="text-2xl font-semibold">Create an account</h1>
      <label className="block">
        <span className="text-sm">Email</span>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
      </label>
      <label className="block">
        <span className="text-sm">Password</span>
        <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
      </label>
      <p className="text-xs text-gray-500">At least 8 characters.</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded bg-blue-600 px-4 py-2 text-white">
        Create account
      </button>
      <p className="text-sm">
        Have an account? <Link href="/login" className="underline">Log in</Link>
      </p>
    </form>
  );
}
