import { redirect } from "next/navigation";
import { SignupForm } from "@/components/auth/SignupForm";
import { getCurrentUserId } from "@/server/session";

export default async function SignupPage() {
  if (await getCurrentUserId()) redirect("/trips");
  return <main className="px-4"><SignupForm /></main>;
}
