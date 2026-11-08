import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { loginNotice } from "@/components/auth/login-notice";
import { ClearOfflineCopies } from "@/components/offline/ClearOfflineCopies";
import { safeCallbackPath } from "@/lib/safe-callback";
import { googleConfigured } from "@/server/auth";
import { getCurrentUserId } from "@/server/session";

export const metadata: Metadata = { title: "Log in · Photo Op Planner" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error, callbackUrl, message } = await searchParams;
  const returnTo = safeCallbackPath(callbackUrl);
  if (await getCurrentUserId()) redirect(returnTo ?? "/trips");
  return (
    <main className="px-4">
      <ClearOfflineCopies />
      <LoginForm google={googleConfigured()} urlError={typeof error === "string" ? error : null} returnTo={returnTo} notice={loginNotice(message)} />
    </main>
  );
}
