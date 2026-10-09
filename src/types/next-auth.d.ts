import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    /** User.sessionVersion at sign-in; a mismatch means the token was revoked. */
    sv?: number;
  }
}
