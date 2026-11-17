import Link from "next/link";
import { cookies } from "next/headers";
import { btnPrimary } from "@/components/ui/styles";

/** Whether the request carries a sign-in cookie. Only its presence is read (no session or database lookup, which could fail on an error page). */
async function hasSessionCookie(): Promise<boolean> {
  try {
    return (await cookies()).getAll().some((c) => c.name.includes("next-auth.session-token"));
  } catch {
    return false;
  }
}

export default async function NotFound() {
  // "/" sends signed-out visitors to the login page and everyone else to their trips, so the label says which.
  const signedIn = await hasSessionCookie();
  return (
    <main className="mx-auto mt-[12vh] w-full max-w-sm space-y-4 rounded-2xl bg-surface p-7 text-center shadow-lg ring-1 ring-border">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted">That page does not exist, or the link has expired.</p>
      <Link href="/" className={btnPrimary}>{signedIn ? "Back to trips" : "Go to home page"}</Link>
    </main>
  );
}
