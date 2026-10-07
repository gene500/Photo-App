import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/SignOutButton";
import { getCurrentUserId } from "@/server/session";

export default async function TripsLayout({ children }: LayoutProps<"/trips">) {
  if (!(await getCurrentUserId())) redirect("/login");
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-12 items-center justify-between border-b px-4">
        <Link href="/trips" className="font-semibold">Road Trip Photo Planner</Link>
        <SignOutButton />
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
