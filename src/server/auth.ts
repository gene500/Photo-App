import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { verifyCredentials } from "./users";

export async function authorizeCredentials(
  credentials: Record<string, string> | undefined,
): Promise<{ id: string; email: string } | null> {
  if (!credentials?.email || !credentials.password) return null;
  return verifyCredentials(credentials.email, credentials.password);
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
      if (user) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token.sub) session.user = { ...session.user, id: token.sub };
      return session;
    },
  },
};
