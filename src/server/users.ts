import bcrypt from "bcryptjs";
import { prisma } from "./db";

const BCRYPT_COST = 10;

export class DuplicateEmailError extends Error {
  constructor() {
    super("An account with that email already exists");
    this.name = "DuplicateEmailError";
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

export async function createUser(
  email: string,
  password: string,
): Promise<{ id: string; email: string }> {
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  try {
    const user = await prisma.user.create({ data: { email: normalizeEmail(email), passwordHash } });
    return { id: user.id, email: user.email };
  } catch (e) {
    if (isUniqueViolation(e)) throw new DuplicateEmailError();
    throw e;
  }
}

// A hash to compare against when the email is unknown, so "no such user" costs the same bcrypt time as "wrong
// password" and response timing doesn't reveal which emails have accounts. Computed once per instance.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= bcrypt.hash("not-a-real-password", BCRYPT_COST));

export async function verifyCredentials(
  email: string,
  password: string,
): Promise<{ id: string; email: string } | null> {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? (await getDummyHash()));
  return user && ok ? { id: user.id, email: user.email } : null;
}

/** The user's current session version, or null when the account no longer exists. */
export async function getSessionVersion(userId: string): Promise<number | null> {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { sessionVersion: true } });
  return row?.sessionVersion ?? null;
}

/** Invalidates every sign-in token issued so far for this user ("sign out everywhere"). */
export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.user.updateMany({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
}

/** Sets a new password after checking the current one, and signs every other device out. */
export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) return false;
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(newPassword, BCRYPT_COST), sessionVersion: { increment: 1 } },
  });
  return true;
}
