import { cache } from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth";

// A page and its layout both ask who is signed in; `cache` makes that one lookup per render instead of two.
const currentSession = cache(() => getServerSession(authOptions));

export async function getCurrentUserId(): Promise<string | null> {
  const session = await currentSession();
  return session?.user?.id ?? null;
}

export async function getCurrentUser(): Promise<{ id: string; email: string | null } | null> {
  const session = await currentSession();
  const id = session?.user?.id;
  return id ? { id, email: session.user.email ?? null } : null;
}

/** Epoch ms of the current session's sign-in, or undefined for tokens issued before it was recorded. */
export async function getAuthTime(): Promise<number | undefined> {
  return (await currentSession())?.authTime;
}
