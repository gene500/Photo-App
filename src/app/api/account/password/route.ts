import { changePasswordSchema } from "@/lib/validation";
import { handle, HttpError, readJson, requireUserId } from "@/server/http";
import { enforceLimit } from "@/server/rate-limit";
import { changePassword } from "@/server/users";

/** Changes the password after checking the current one. Every session ends, so the caller signs in again. */
export const POST = handle(async (req: Request) => {
  const userId = await requireUserId();
  enforceLimit("password-change", userId);
  const { currentPassword, newPassword } = changePasswordSchema.parse(await readJson(req));
  if (!(await changePassword(userId, currentPassword, newPassword))) throw new HttpError(403, "That password is not correct");
  return new Response(null, { status: 204 });
});
