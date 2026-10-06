import { signupSchema } from "@/lib/validation";
import { handle, HttpError, readJson } from "@/server/http";
import { createUser, DuplicateEmailError } from "@/server/users";

export const POST = handle(async (req: Request) => {
  const { email, password } = signupSchema.parse(await readJson(req));
  try {
    const user = await createUser(email, password);
    return Response.json({ user }, { status: 201 });
  } catch (e) {
    if (e instanceof DuplicateEmailError) throw new HttpError(409, e.message);
    throw e;
  }
});
