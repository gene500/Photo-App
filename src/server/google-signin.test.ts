import { beforeEach, describe, expect, it } from "vitest";
import { handleGoogleSignIn } from "./auth";
import { prisma } from "./db";
import { changePassword, createUser, deleteAccount, EMAIL_IN_USE, findOrCreateGoogleUser, hasPassword, verifyCredentials } from "./users";
import { resetDb } from "../../tests/helpers/db";

describe("google sign-in", () => {
  beforeEach(resetDb);

  it("creates a Google-only account, then finds it again by sub", async () => {
    const first = await findOrCreateGoogleUser("sub-1", "G@Example.com");
    expect(first).toMatchObject({ email: "g@example.com" });
    const again = await findOrCreateGoogleUser("sub-1", "other@example.com");
    expect(again).toEqual(first);
    expect(await prisma.user.count()).toBe(1);
    expect(await hasPassword((first as { id: string }).id)).toBe(false);
  });

  it("refuses to take over an existing account with the same email", async () => {
    await createUser("taken@example.com", "correct-horse");
    expect(await findOrCreateGoogleUser("sub-2", "taken@example.com")).toBe(EMAIL_IN_USE);
    expect(await prisma.user.count()).toBe(1);
  });

  it("handles a concurrent create of the same email", async () => {
    const results = await Promise.all([findOrCreateGoogleUser("sub-a", "race@example.com"), findOrCreateGoogleUser("sub-b", "race@example.com")]);
    expect(await prisma.user.count()).toBe(1);
    expect(results.filter((r) => r === EMAIL_IN_USE).length).toBeLessThanOrEqual(1);
  });

  it("handleGoogleSignIn rejects unverified or incomplete profiles", async () => {
    expect(await handleGoogleSignIn({}, { sub: "s", email: "a@example.com", email_verified: false })).toBe("/login?error=GoogleUnverified");
    expect(await handleGoogleSignIn({}, { sub: "s", email: "a@example.com" })).toBe("/login?error=GoogleUnverified");
    expect(await handleGoogleSignIn({}, { email: "a@example.com", email_verified: true })).toBe("/login?error=GoogleUnverified");
    expect(await handleGoogleSignIn({}, undefined)).toBe("/login?error=GoogleUnverified");
    expect(await prisma.user.count()).toBe(0);
  });

  it("handleGoogleSignIn sets the app account id, and refuses an email already in use", async () => {
    const user: { id?: string; email?: string | null } = { id: "google-id" };
    expect(await handleGoogleSignIn(user, { sub: "s", email: "new@example.com", email_verified: true })).toBe(true);
    const row = await prisma.user.findUniqueOrThrow({ where: { googleSub: "s" } });
    expect(user).toEqual({ id: row.id, email: "new@example.com" });
    await createUser("used@example.com", "correct-horse");
    expect(await handleGoogleSignIn({}, { sub: "t", email: "used@example.com", email_verified: true })).toBe("/login?error=GoogleEmailInUse");
  });

  it("Google-only accounts cannot use a password", async () => {
    const acct = (await findOrCreateGoogleUser("sub-3", "nopw@example.com")) as { id: string };
    expect(await verifyCredentials("nopw@example.com", "anything-at-all")).toBeNull();
    expect(await changePassword(acct.id, "x", "new-password-123")).not.toBe(true);
  });

  it("Google-only accounts delete by confirming their email", async () => {
    const acct = (await findOrCreateGoogleUser("sub-4", "bye@example.com")) as { id: string };
    expect(await deleteAccount(acct.id, { confirmEmail: "wrong@example.com" })).toBeNull();
    expect(await deleteAccount(acct.id, { password: "guess" })).toBeNull();
    expect(await deleteAccount(acct.id, { confirmEmail: " Bye@Example.com " })).toEqual({ photoUrls: [] });
    expect(await prisma.user.count()).toBe(0);
  });

  it("a password account cannot be deleted by typing its email", async () => {
    const user = await createUser("pw@example.com", "correct-horse");
    expect(await deleteAccount(user.id, { confirmEmail: "pw@example.com" })).toBeNull();
    expect(await deleteAccount(user.id, {})).toBeNull();
    expect(await prisma.user.count()).toBe(1);
  });

  it("a stored googleSub cannot be reached through the password login", async () => {
    await findOrCreateGoogleUser("sub-5", "g5@example.com");
    expect(await verifyCredentials("g5@example.com", "")).toBeNull();
  });
});
