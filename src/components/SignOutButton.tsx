"use client";

import { signIn, signOut } from "next-auth/react";
import { useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { softDisabled } from "@/lib/focus";
import { clearAllCopies, disableOfflineSaving } from "@/lib/offline-store";

const SIGN_OUT_FAILED = "Couldn't sign out. Check your connection and try again.";

/**
 * Ends this device's session: signs out without letting next-auth navigate, so nothing leaves the page until the
 * answer is known. next-auth does not expose the status, so a 500 shows up as an answer without a redirect url
 * (its JSON error body) and a CSRF or server failure as a redirect to an error/csrf url; none of those counts as signed out.
 */
async function requestSignOut(): Promise<string | null> {
  let result: { url?: unknown } | undefined;
  try {
    result = await signOut({ callbackUrl: "/login", redirect: false });
  } catch {
    return null;
  }
  const url = result?.url;
  if (typeof url !== "string" || /\/api\/auth\/error|[?&]error=|[?&]csrf=true/.test(url)) return null;
  return url;
}

/**
 * Awaited, offline-safe sign-out shared by every button that ends the session. `beforeLeaving` runs only once the
 * sign-out is confirmed (SignOutButton wipes this device's copies there). Failures are shown, never swallowed.
 */
function useDeviceSignOut() {
  const [error, setError] = useState<string | null>(null);
  async function run(beforeLeaving?: () => void): Promise<boolean> {
    setError(null);
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setError("You're offline: sign-out needs a connection.");
      return false;
    }
    const url = await requestSignOut();
    if (url === null) {
      setError(SIGN_OUT_FAILED);
      return false;
    }
    beforeLeaving?.();
    window.location.assign(url);
    return true;
  }
  return { error, run };
}

const wipeDevice = () => {
  // Saving is switched off first so a pending autosave cannot bring a copy back before the page leaves.
  disableOfflineSaving();
  clearAllCopies();
};

/** Signing out on a shared device must not leave this user's trips behind (see below). */
export function SignOutEverywhereButton({ className }: { className?: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);
  const deviceSignOut = useDeviceSignOut();
  async function run() {
    if (pending) return; // the button stays focusable while busy (softDisabled), so a second press lands here
    setPending(true);
    setError(null);
    if (!revoked) {
      try {
        await api.signOutEverywhere();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't sign out everywhere");
        setPending(false);
        return;
      }
      setRevoked(true);
      wipeDevice();
    }
    // Every session is already revoked on the server; a failure here only means this tab did not leave, so retrying skips the revoke.
    if (!(await deviceSignOut.run())) setPending(false);
  }
  return (
    <div className="space-y-2">
      <button type="button" {...softDisabled(pending)} onClick={() => void run()} className={`${className ?? ""} aria-disabled:opacity-50`}>
        {revoked && deviceSignOut.error ? "Try again" : "Sign out on all devices"}
      </button>
      {(error ?? deviceSignOut.error) && <p role="alert" className="text-sm text-danger">{error ?? deviceSignOut.error}</p>}
    </div>
  );
}

export function SignOutButton({ className }: { className?: string }) {
  const { error, run } = useDeviceSignOut();
  return (
    <>
      <button type="button" onClick={() => void run(wipeDevice)} className={className ?? "inline-flex min-h-9 items-center rounded-lg px-3 text-sm text-muted transition hover:bg-hover hover:text-foreground"}>
        Sign out
      </button>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </>
  );
}

/** Permanent account deletion: asks for the password, then wipes this device's offline copies and signs out. */
export function DeleteAccountButton({ className, hasPassword = true }: { className?: string; hasPassword?: boolean }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const deviceSignOut = useDeviceSignOut();
  async function run() {
    if (pending || password === "") return;
    setPending(true);
    setError(null);
    setNeedsReauth(false);
    if (!deleted) {
      try {
        await api.deleteAccount(hasPassword ? { password } : { confirmEmail: password });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't delete the account");
        setNeedsReauth(e instanceof ApiError && e.reason === "reauth");
        setPending(false);
        return;
      }
      setDeleted(true);
      wipeDevice();
    }
    // The account is gone; if this tab cannot sign out, say so and let the user retry without deleting again.
    if (!(await deviceSignOut.run())) setPending(false);
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
        <button type="submit" {...softDisabled(pending || password === "")} className="inline-flex min-h-9 items-center rounded-lg bg-danger px-3 text-sm text-white aria-disabled:opacity-50">
          {pending ? "Deleting…" : deleted ? "Try again" : "Delete my account"}
        </button>
        <button type="button" disabled={pending} onClick={() => { setOpen(false); setPassword(""); setError(null); setNeedsReauth(false); }} className={className}>
          Cancel
        </button>
      </div>
      {(error ?? deviceSignOut.error) && <p role="alert" className="text-sm text-danger">{error ?? deviceSignOut.error}</p>}
      {needsReauth && (
        // Google documents only none, consent and select_account for `prompt` (other values can be refused); the account chooser is a fresh sign-in step that restarts the five-minute window.
        <button type="button" onClick={() => void signIn("google", { callbackUrl: window.location.href }, { prompt: "select_account" })} className={className}>
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
  const [changed, setChanged] = useState(false);
  const deviceSignOut = useDeviceSignOut();
  async function run() {
    if (pending || current === "") return;
    if (next.length < 8) {
      setError("The new password must be at least 8 characters.");
      return;
    }
    setPending(true);
    setError(null);
    if (!changed) {
      try {
        await api.changePassword(current, next);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't change the password");
        setPending(false);
        return;
      }
      setChanged(true);
      wipeDevice();
    }
    if (!(await deviceSignOut.run())) setPending(false);
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
        <input type="password" required autoComplete="new-password" value={next} onChange={(e) => { setNext(e.target.value); setError(null); }} className={field} />
      </label>
      <p className="text-xs text-muted">At least 8 characters. You will be signed out everywhere and asked to sign in again.</p>
      <div className="flex gap-2">
        <button type="submit" {...softDisabled(pending || current === "")} className={`${className ?? ""} aria-disabled:opacity-50`}>
          {pending ? "Changing…" : changed ? "Try again" : "Change password"}
        </button>
        <button type="button" disabled={pending} onClick={() => { setOpen(false); setCurrent(""); setNext(""); setError(null); }} className={className}>
          Cancel
        </button>
      </div>
      {(error ?? deviceSignOut.error) && <p role="alert" className="text-sm text-danger">{error ?? deviceSignOut.error}</p>}
    </form>
  );
}
