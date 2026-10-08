import Link from "next/link";
import { redirect } from "next/navigation";
import { OfflineOwnerSync } from "@/components/offline/OfflineOwnerSync";
import { SignOutButton } from "@/components/SignOutButton";
import { getCurrentUserId } from "@/server/session";

export default async function TripsLayout({ children }: LayoutProps<"/trips">) {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex min-h-12 items-center justify-between gap-2 bg-surface px-4 shadow-sm">
        <Link href="/trips" className="min-w-0 truncate text-sm font-semibold tracking-tight">Road Trip Photo Planner</Link>
        <div className="flex shrink-0 items-center">
          <Link href="/settings" aria-label="Settings" title="Settings" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent-strong">
            <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h0a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h0a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v0a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
            </svg>
          </Link>
          <SignOutButton />
        </div>
      </header>
      <OfflineOwnerSync userId={userId} />
      <div className="flex-1">{children}</div>
    </div>
  );
}
