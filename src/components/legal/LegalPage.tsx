import Link from "next/link";
import type { ReactNode } from "react";

export const LEGAL_UPDATED = "October 9, 2026";
export const CONTACT_URL = "https://github.com/gene500/Photo-App/issues";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <nav className="mb-6 text-sm">
        <Link href="/" className="inline-flex min-h-6 items-center text-muted underline underline-offset-2">← Photo Op Planner</Link>
      </nav>
      <h1 className="text-3xl font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-muted">Last updated {LEGAL_UPDATED}</p>
      <div className="mt-6 space-y-4 text-sm leading-relaxed [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_a]:underline [&_a]:underline-offset-2">
        {children}
      </div>
      <footer className="mt-10 border-t border-border pt-4 text-sm text-muted">
        <Link href="/privacy" className="inline-flex min-h-6 items-center underline underline-offset-2">Privacy</Link>
        {" · "}
        <Link href="/terms" className="inline-flex min-h-6 items-center underline underline-offset-2">Terms</Link>
      </footer>
    </main>
  );
}

export function LegalLinks() {
  return (
    <p className="text-xs text-muted">
      <Link href="/privacy" className="inline-flex min-h-6 items-center underline underline-offset-2">Privacy</Link>
      {" · "}
      <Link href="/terms" className="inline-flex min-h-6 items-center underline underline-offset-2">Terms</Link>
    </p>
  );
}
