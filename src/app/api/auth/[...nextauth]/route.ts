import { NextRequest } from "next/server";
import NextAuth from "next-auth";
import { authOptions } from "@/server/auth";
import { guardAuthPost, sanitizeAuthRequest } from "@/server/login-guard";

const handler = NextAuth(authOptions);

// NextAuth reads `req.nextUrl`, so a request rebuilt by sanitizeAuthRequest is wrapped again.
const clean = async (req: NextRequest) => {
  const out = await sanitizeAuthRequest(req);
  return out === req ? req : new NextRequest(out);
};

// An unparseable callbackUrl is dropped first, so NextAuth falls back to the default instead of answering a 500.
export async function GET(req: NextRequest, ctx: { params: Promise<{ nextauth: string[] }> }) {
  return handler(await clean(req), ctx);
}

// POSTs (sign-in, sign-out) pass the cross-site check and the login throttles first.
export async function POST(req: NextRequest, ctx: { params: Promise<{ nextauth: string[] }> }) {
  return (await guardAuthPost(req)) ?? handler(await clean(req), ctx);
}
