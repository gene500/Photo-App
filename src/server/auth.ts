import type { NextAuthOptions, Session } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { hitShared, isBlockedShared, resetShared } from "./shared-limit";
import { EMAIL_IN_USE, findOrCreateGoogleUser, getSessionVersion, verifyCredentials } from "./users";

export const RATE_LIMITED = "RateLimited";

export async function authorizeCredentials(
  credentials: Record<string, string> | undefined,
): Promise<{ id: string; email: string } | null> {
  if (!credentials?.email || !credentials.password) return null;
  const key = credentials.email.trim().toLowerCase();
  // Per-email throttle on failures (the per-IP limit is applied in the route before NextAuth runs).
  if (!(await isBlockedShared("login-email-failures", key)).ok) throw new Error(RATE_LIMITED);
  const user = await verifyCredentials(credentials.email, credentials.password);
  if (user) await resetShared("login-email-failures", key);
  else await hitShared("login-email-failures", key);
  return user;
}

/** Google sign-in is offered only when both values are configured. */
export const googleConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

/**
 * Runs after Google has authenticated someone: finds or creates the app account for that Google identity and puts
 * its id on `user`, so the token carries our id and not Google's. Returns false or a /login?error=… URL to refuse.
 */
export async function handleGoogleSignIn(
  user: { id?: string; email?: string | null },
  profile: { sub?: string; email?: string; email_verified?: boolean } | undefined,
): Promise<boolean | string> {
  if (!profile?.sub || !profile.email || profile.email_verified !== true) return "/login?error=GoogleUnverified";
  const account = await findOrCreateGoogleUser(profile.sub, profile.email);
  if (account === EMAIL_IN_USE) return "/login?error=GoogleEmailInUse";
  user.id = account.id;
  user.email = account.email;
  return true;
}

// The Credentials provider only supports the JWT strategy: an encrypted
// httpOnly cookie, verified server-side by getServerSession.
export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET,
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: (credentials) => authorizeCredentials(credentials),
    }),
    ...(googleConfigured()
      ? [GoogleProvider({ clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! })]
      : []),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== "google") return true;
      return handleGoogleSignIn(user, profile as { sub?: string; email?: string; email_verified?: boolean } | undefined);
    },
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        // Stamp the token with the user's current session version; bumping it later revokes this token.
        token.sv = (await getSessionVersion(user.id)) ?? 0;
      }
      return token;
    },
    async session({ session, token }) {
      if (!token.sub) return session;
      // Tokens from before versioning have no `sv` (= 0, the column default). A deleted user or a bumped
      // version yields a session without a user, which every caller treats as signed out (401).
      const current = await getSessionVersion(token.sub);
      if (current === null || current !== (token.sv ?? 0)) return { expires: session.expires } as Session;
      session.user = { ...session.user, id: token.sub };
      return session;
    },
  },
};
