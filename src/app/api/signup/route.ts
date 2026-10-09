import { z } from "zod";
import { signupSchema } from "@/lib/validation";
import { handle, HttpError, readJson } from "@/server/http";
import { clientIp, enforceLimit } from "@/server/rate-limit";
import { checkSignupToken } from "@/server/signup-guard";
import { createUser, DuplicateEmailError } from "@/server/users";

// Bot signals, not part of the account: a hidden field only bots fill in, and the signed page-load timestamp.
const guardSchema = z.object({ website: z.string().max(500).optional(), formToken: z.string().max(200).optional() });

export const POST = handle(async (req: Request) => {
  enforceLimit("signup-ip", clientIp(req.headers));
  const body = await readJson(req);
  const { website, formToken } = guardSchema.parse(body ?? {});
  if (website) {
    // Honeypot: pretend it worked so the bot learns nothing, but create nothing.
    return Response.json({ user: { id: "", email: "" } }, { status: 201 });
  }
  const token = checkSignupToken(formToken);
  if (token === "invalid" || token === "expired") throw new HttpError(400, "Please reload the page and try again");
  if (token === "too-fast") throw new HttpError(400, "That was quick. Please wait a moment and try again");
  const { email, password } = signupSchema.parse(body);
  enforceLimit("signup-email", email);
  try {
    const user = await createUser(email, password);
    return Response.json({ user }, { status: 201 });
  } catch (e) {
    if (e instanceof DuplicateEmailError) throw new HttpError(409, e.message);
    throw e;
  }
});
