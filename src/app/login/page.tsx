import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { ClearOfflineCopies } from "@/components/offline/ClearOfflineCopies";
import { googleConfigured } from "@/server/auth";
import { getCurrentUserId } from "@/server/session";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getCurrentUserId()) redirect("/trips");
  const { error } = await searchParams;
  return <main className="px-4"><ClearOfflineCopies /><LoginForm google={googleConfigured()} urlError={typeof error === "string" ? error : null} /></main>;
}
