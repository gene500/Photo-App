import { getServerSession } from "next-auth";
import { authOptions } from "./auth";

export async function getCurrentUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.id ?? null;
}

export async function getCurrentUser(): Promise<{ id: string; email: string | null } | null> {
  const session = await getServerSession(authOptions);
  const id = session?.user?.id;
  return id ? { id, email: session.user.email ?? null } : null;
}
