import { redirect } from "next/navigation";
import { SignupForm } from "@/components/auth/SignupForm";
import { getCurrentUserId } from "@/server/session";
import { issueSignupToken } from "@/server/signup-guard";

export default async function SignupPage() {
  if (await getCurrentUserId()) redirect("/trips");
  return <main className="px-4"><SignupForm formToken={issueSignupToken()} /></main>;
}
