import type { NextAuthOptions, Session } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { hit, isBlocked, resetLimit } from "./rate-limit";
import { getSessionVersion, verifyCredentials } from "./users";

export const RATE_LIMITED = "RateLimited";

export async function authorizeCredentials(
  credentials: Record<string, string> | undefined,
): Promise<{ id: string; email: string } | null> {
  if (!credentials?.email || !credentials.password) return null;
  const key = credentials.email.trim().toLowerCase();
  // Per-email throttle on failures (the per-IP limit is applied in the route before NextAuth runs).
  if (!isBlocked("login-email-failures", key).ok) throw new Error(RATE_LIMITED);
  const user = await verifyCredentials(credentials.email, credentials.password);
  if (user) resetLimit("login-email-failures", key);
  else hit("login-email-failures", key);
  return user;
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
  ],
  callbacks: {
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
