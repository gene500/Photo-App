import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { card } from "@/components/ui/styles";
import { getBudgetUsage, isOwner, type BudgetUsage } from "@/server/budget";
import { getCurrentUserId } from "@/server/session";

export const metadata: Metadata = { title: "API usage · Photo Op Planner" };
// Reads live counters and the signed-in account, so it can never be prerendered.
export const dynamic = "force-dynamic";

const num = (n: number) => n.toLocaleString("en-US");
const date = (ms: number) => new Date(ms).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

export default async function UsagePage() {
  const userId = await getCurrentUserId();
  // Anyone who is not the owner gets a plain 404 before any usage data is read.
  if (!userId || !(await isOwner(userId).catch(() => false))) notFound();

  let usage: BudgetUsage[] | null = null;
  try {
    usage = await getBudgetUsage();
  } catch {
    usage = null;
  }

  return (
    <main className="mx-auto w-full max-w-2xl space-y-5 px-4 py-6">
      <Link href="/settings" className="text-sm text-muted hover:text-foreground">‹ Settings</Link>
      <h1 className="text-2xl font-semibold">API usage</h1>
      {usage === null ? (
        <p role="status" className={`p-5 text-sm text-muted ${card}`}>Usage is unavailable right now. Try again in a moment.</p>
      ) : (
        <ul className="space-y-3">
          {usage.map((u) => (
            <li key={u.product} className={`space-y-1 p-3 min-[360px]:p-5 ${card}`}>
              <h2 className="text-base font-semibold">
                {u.label}
                {!u.confirmed && <span className="ml-2 rounded bg-hover px-1.5 py-0.5 text-xs font-normal text-muted">unconfirmed</span>}
              </h2>
              {u.cap === null ? (
                <p className="text-sm">Used this month: {num(u.used)}. No cap.</p>
              ) : (
                <p className="text-sm">Used {num(u.used)} of {num(u.cap)} ({Math.floor((u.used / u.cap) * 100)}%)</p>
              )}
              <p className="text-xs text-muted">
                Monthly allowance: {u.allowance === null ? "none" : num(u.allowance)}. Resets {date(u.resetsAt)} (UTC).
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
