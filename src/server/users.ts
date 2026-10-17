import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { TtlCache } from "./suggestions/cache";

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
  // A Google-only account has no password: compare against the dummy so the timing matches, and refuse.
  const usable = user?.passwordSet ? user.passwordHash : undefined;
  const ok = await bcrypt.compare(password, usable ?? (await getDummyHash()));
  return user && usable && ok ? { id: user.id, email: user.email } : null;
}

export const EMAIL_IN_USE = "email-in-use";

/**
 * The account for a verified Google identity, created on first use. An existing account that has the same email but
 * was not made with this Google identity is never taken over: the caller refuses the sign-in (EMAIL_IN_USE).
 */
export async function findOrCreateGoogleUser(sub: string, email: string): Promise<{ id: string; email: string } | typeof EMAIL_IN_USE> {
  const bySub = await prisma.user.findUnique({ where: { googleSub: sub } });
  if (bySub) return { id: bySub.id, email: bySub.email };
  const normalized = normalizeEmail(email);
  if (await prisma.user.findUnique({ where: { email: normalized } })) return EMAIL_IN_USE;
  // The password is random and never shown: this account signs in with Google only.
  const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), BCRYPT_COST);
  try {
    const user = await prisma.user.create({ data: { email: normalized, passwordHash, passwordSet: false, googleSub: sub } });
    return { id: user.id, email: user.email };
  } catch (e) {
    if (isUniqueViolation(e)) return EMAIL_IN_USE; // lost a race with a concurrent signup of the same email
    throw e;
  }
}

/** Whether this account has a password (false for Google-only accounts). */
export async function hasPassword(userId: string): Promise<boolean> {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { passwordSet: true } });
  return row?.passwordSet ?? true;
}

// Every signed-in request checks the session version, which is a database round trip. Remember the answer briefly per
// server instance; revoking clears it on the instance that handled the revoke, and other instances see it within the TTL.
export const SESSION_VERSION_TTL_MS = 15_000;
// Next bundles route handlers and pages as separate module instances, so the cache lives on globalThis: a revoke made
// in a route handler must clear the entry the page-side check reads, or the old session stays valid for the whole TTL.
const globalForVersions = globalThis as unknown as { __sessionVersions?: TtlCache<number | null> };
const versions = (globalForVersions.__sessionVersions ??= new TtlCache<number | null>(SESSION_VERSION_TTL_MS, 2000));
export const clearSessionVersionCache = () => versions.clear();

/** The user's current session version, or null when the account no longer exists. */
export async function getSessionVersion(userId: string): Promise<number | null> {
  const cached = versions.get(userId);
  if (cached !== undefined) return cached;
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { sessionVersion: true } });
  const version = row?.sessionVersion ?? null;
  versions.set(userId, version);
  return version;
}

/** Invalidates every sign-in token issued so far for this user ("sign out everywhere"). */
export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.user.updateMany({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
  versions.delete(userId);
}

/** Sets a new password after checking the current one, and ends every session, this one included. */
export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.passwordSet || !(await bcrypt.compare(currentPassword, user.passwordHash))) return false;
  // Compare-and-swap on the hash that was just checked: of several simultaneous changes only one wins.
  const { count } = await prisma.user.updateMany({
    where: { id: userId, passwordHash: user.passwordHash },
    data: { passwordHash: await bcrypt.hash(newPassword, BCRYPT_COST), sessionVersion: { increment: 1 } },
  });
  versions.delete(userId);
  return count === 1;
}

/** A Google-only account may be deleted only this long after the user last signed in. */
export const REAUTH_WINDOW_MS = 5 * 60 * 1000;
/** Returned by deleteAccount when a Google-only account's sign-in is too old: sign in again, then retry. */
export const REAUTH_REQUIRED = "reauth-required";

/**
 * Permanently deletes the account after checking the password (or, for a Google-only account, the typed email
 * plus a sign-in within REAUTH_WINDOW_MS; `authTime` is the epoch ms of that sign-in). Trips and stops go with it
 * (cascade); the stops' photo URLs are returned so the caller can remove the files.
 * null = wrong password/email or no such account; REAUTH_REQUIRED = the sign-in is too old.
 */
export async function deleteAccount(
  userId: string,
  proof: { password?: string; confirmEmail?: string; authTime?: number },
): Promise<{ photoUrls: string[] } | typeof REAUTH_REQUIRED | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  // The email is not a secret to whoever holds the session, so a Google-only account also needs a fresh sign-in.
  // A token without a sign-in time (issued before this check existed) counts as stale.
  if (!user.passwordSet && !(proof.authTime !== undefined && Date.now() - proof.authTime <= REAUTH_WINDOW_MS)) return REAUTH_REQUIRED;
  // Password accounts confirm with the password; Google-only accounts (no password) by typing their email address.
  const confirmed = user.passwordSet
    ? proof.password !== undefined && (await bcrypt.compare(proof.password, user.passwordHash))
    : proof.confirmEmail !== undefined && normalizeEmail(proof.confirmEmail) === user.email;
  if (!confirmed) return null;
  // One transaction, so a photo attached between the read and the delete cannot be left behind.
  const stops = await prisma.$transaction(async (tx) => {
    const rows = await tx.stop.findMany({ where: { trip: { userId } }, select: { photoUrl: true } });
    await tx.user.delete({ where: { id: userId } });
    return rows;
  });
  versions.delete(userId);
  return { photoUrls: stops.map((s) => s.photoUrl).filter((u): u is string => u !== null) };
}
