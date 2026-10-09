import type { NextRequest } from "next/server";
import NextAuth from "next-auth";
import { authOptions } from "@/server/auth";
import { guardAuthPost } from "@/server/login-guard";

const handler = NextAuth(authOptions);

export { handler as GET };

// POSTs (sign-in, sign-out) pass the cross-site check and the login throttles first.
export async function POST(req: NextRequest, ctx: { params: Promise<{ nextauth: string[] }> }) {
  return (await guardAuthPost(req)) ?? handler(req, ctx);
}
