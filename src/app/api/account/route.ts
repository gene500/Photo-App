import { deleteAccountSchema } from "@/lib/validation";
import { handle, HttpError, readJson, requireUserId } from "@/server/http";
import { deletePhotoFile } from "@/server/photos";
import { enforceLimit } from "@/server/rate-limit";
import { deleteAccount } from "@/server/users";

/** Permanently deletes the account, its trips, stops and uploaded photos. The password must be confirmed. */
export const DELETE = handle(async (req: Request) => {
  const userId = await requireUserId();
  enforceLimit("account-delete", userId);
  const { password } = deleteAccountSchema.parse(await readJson(req));
  const result = await deleteAccount(userId, password);
  if (!result) throw new HttpError(403, "That password is not correct");
  await Promise.allSettled(result.photoUrls.map((url) => deletePhotoFile(url)));
  return new Response(null, { status: 204 });
});
