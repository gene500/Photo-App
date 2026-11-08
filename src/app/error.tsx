"use client";

import Link from "next/link";
import { btnPrimary, btnSecondary } from "@/components/ui/styles";

// Route-level error boundary. Deliberately shows no error message or digest: those can leak internals.
export default function RouteError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="mx-auto mt-[12vh] w-full max-w-sm space-y-4 rounded-2xl bg-surface p-7 text-center shadow-lg ring-1 ring-border">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted">This page could not be shown. You can try again, or go back to your trips.</p>
      <div className="flex justify-center gap-2">
        <button type="button" onClick={() => retry()} className={btnPrimary}>Try again</button>
        {/* "/" sends signed-out visitors to the login page and everyone else to their trips. */}
        <Link href="/" className={btnSecondary}>Back to trips</Link>
      </div>
    </main>
  );
}
