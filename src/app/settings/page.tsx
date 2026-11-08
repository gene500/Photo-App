import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { loginUrl } from "@/lib/safe-callback";
import { SettingsView } from "@/components/settings/SettingsView";
import { getCurrentUser } from "@/server/session";
import { hasPassword } from "@/server/users";

export const metadata: Metadata = { title: "Settings · Photo Op Planner" };

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect(loginUrl("/settings"));
  return <SettingsView email={user.email} hasPassword={await hasPassword(user.id)} />;
}
