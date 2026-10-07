"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState } from "react";

const inputClass = "mt-1 w-full rounded border px-2 py-1";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setError(null);
    const res = await signIn("credentials", { email, password, redirect: false });
    setPending(false);
    if (!res || res.error) {
      setError("Invalid email or password");
      return;
    }
    router.push("/trips");
    router.refresh();
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="mx-auto mt-16 w-full max-w-sm space-y-4">
      <h1 className="text-2xl font-semibold">Log in</h1>
      <label className="block">
        <span className="text-sm">Email</span>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
      </label>
      <label className="block">
        <span className="text-sm">Password</span>
        <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
      </label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded bg-blue-600 px-4 py-2 text-white">
        Log in
      </button>
      <p className="text-sm">
        No account? <Link href="/signup" className="underline">Sign up</Link>
      </p>
    </form>
  );
}
