import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignupForm } from "@/components/auth/SignupForm";
import { ClearOfflineCopies } from "@/components/offline/ClearOfflineCopies";
import { googleConfigured } from "@/server/auth";
import { getCurrentUserId } from "@/server/session";
import { issueSignupToken } from "@/server/signup-guard";

export const metadata: Metadata = { title: "Sign up · Photo Op Planner" };

export default async function SignupPage() {
  if (await getCurrentUserId()) redirect("/trips");
  return <main className="px-4"><ClearOfflineCopies /><SignupForm formToken={issueSignupToken()} google={googleConfigured()} /></main>;
}
