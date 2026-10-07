import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { getCurrentUserId } from "@/server/session";

export default async function LoginPage() {
  if (await getCurrentUserId()) redirect("/trips");
  return <main className="px-4"><LoginForm /></main>;
}
