"use client";

import { signIn, signOut } from "next-auth/react";
import { useState } from "react";
import { api, ApiError } from "@/lib/api-client";
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

export function SignOutButton({ className }: { className?: string }) {
  return (
    <button type="button" onClick={() => {
        // A shared device must not keep this user's trips. Saving is switched off first so a pending
        // autosave cannot bring a copy back while the async sign-out is in flight.
        disableOfflineSaving();
        clearAllCopies();
        void signOut({ callbackUrl: "/login" });
      }} className={className ?? "inline-flex min-h-9 items-center rounded-lg px-3 text-sm text-muted transition hover:bg-hover hover:text-foreground"}>
      Sign out
    </button>
  );
}

/** Permanent account deletion: asks for the password, then wipes this device's offline copies and signs out. */
export function DeleteAccountButton({ className, hasPassword = true }: { className?: string; hasPassword?: boolean }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  async function run() {
    setPending(true);
    setError(null);
    setNeedsReauth(false);
    try {
      await api.deleteAccount(hasPassword ? { password } : { confirmEmail: password });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete the account");
      setNeedsReauth(e instanceof ApiError && e.reason === "reauth");
      setPending(false);
      return;
    }
    disableOfflineSaving();
    clearAllCopies();
    void signOut({ callbackUrl: "/login" });
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={className}>
        Delete account…
      </button>
    );
  }
  return (
    <form method="post" onSubmit={(e) => { e.preventDefault(); void run(); }} className="space-y-2">
      <p className="text-xs text-muted">This permanently deletes your account, all your trips, stops and photos. It cannot be undone. {hasPassword ? "Enter your password to confirm." : "Type your email address to confirm."}</p>
      <label className="block text-sm">
        <span className="text-muted">{hasPassword ? "Password" : "Email address"}</span>
        <input type={hasPassword ? "password" : "email"} required autoFocus autoComplete={hasPassword ? "current-password" : "off"} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 block w-full max-w-xs rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={pending || password === ""} className="inline-flex min-h-9 items-center rounded-lg bg-danger px-3 text-sm text-white disabled:opacity-50">
          {pending ? "Deleting…" : "Delete my account"}
        </button>
        <button type="button" disabled={pending} onClick={() => { setOpen(false); setPassword(""); setError(null); setNeedsReauth(false); }} className={className}>
          Cancel
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {needsReauth && (
        // prompt=login makes Google ask for a fresh login, which restarts the five-minute window.
        <button type="button" onClick={() => void signIn("google", { callbackUrl: window.location.href }, { prompt: "login" })} className={className}>
          Sign in with Google again
        </button>
      )}
    </form>
  );
}

/** Changes the password. The server ends every session, so on success this signs out and sends the user to log in again. */
export function ChangePasswordButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setPending(true);
    setError(null);
    try {
      await api.changePassword(current, next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't change the password");
      setPending(false);
      return;
    }
    disableOfflineSaving();
    clearAllCopies();
    void signOut({ callbackUrl: "/login" });
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={className}>
        Change password…
      </button>
    );
  }
  const field = "mt-1 block w-full max-w-xs rounded-lg border border-border bg-surface px-3 py-2 text-sm";
  return (
    <form method="post" onSubmit={(e) => { e.preventDefault(); void run(); }} className="space-y-2">
      <label className="block text-sm">
        <span className="text-muted">Current password</span>
        <input type="password" required autoFocus autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={field} />
      </label>
      <label className="block text-sm">
        <span className="text-muted">New password</span>
        <input type="password" required minLength={8} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={field} />
      </label>
      <p className="text-xs text-muted">At least 8 characters. You will be signed out everywhere and asked to sign in again.</p>
      <div className="flex gap-2">
        <button type="submit" disabled={pending || current === "" || next.length < 8} className={className}>
          {pending ? "Changing…" : "Change password"}
        </button>
        <button type="button" disabled={pending} onClick={() => { setOpen(false); setCurrent(""); setNext(""); setError(null); }} className={className}>
          Cancel
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </form>
  );
}
