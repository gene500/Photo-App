import Link from "next/link";
import { btnPrimary } from "@/components/ui/styles";

export default function NotFound() {
  return (
    <main className="mx-auto mt-[12vh] w-full max-w-sm space-y-4 rounded-2xl bg-surface p-7 text-center shadow-lg ring-1 ring-border">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted">That page does not exist, or the link has expired.</p>
      {/* "/" sends signed-out visitors to the login page and everyone else to their trips. */}
      <Link href="/" className={btnPrimary}>Back to trips</Link>
    </main>
  );
}
