import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
    /** Epoch ms of the user's last sign-in (see JWT.authTime). */
    authTime?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    /** User.sessionVersion at sign-in; a mismatch means the token was revoked. */
    sv?: number;
    /** Epoch ms when the user last signed in; used to require a recent sign-in for account deletion. */
    authTime?: number;
  }
}
