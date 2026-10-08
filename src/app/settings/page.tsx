import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SettingsView } from "@/components/settings/SettingsView";
import { getCurrentUser } from "@/server/session";

export const metadata: Metadata = { title: "Settings · Photo Op Planner" };

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <SettingsView email={user.email} />;
}
