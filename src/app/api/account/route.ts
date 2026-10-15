import { deleteAccountSchema } from "@/lib/validation";
import { handle, HttpError, readJson, requireUserId } from "@/server/http";
import { deletePhotoFile } from "@/server/photos";
import { enforceLimit } from "@/server/rate-limit";
import { deleteAccount } from "@/server/users";

/** Permanently deletes the account, its trips, stops and uploaded photos. The password must be confirmed. */
export const DELETE = handle(async (req: Request) => {
  const userId = await requireUserId();
  enforceLimit("account-delete", userId);
  const proof = deleteAccountSchema.parse(await readJson(req));
  const result = await deleteAccount(userId, proof);
  if (!result) throw new HttpError(403, proof.password === undefined ? "That email address does not match" : "That password is not correct");
  const removed = await Promise.all(result.photoUrls.map((url) => deletePhotoFile(url)));
  const failed = removed.filter((ok) => !ok).length;
  if (failed > 0) console.error(`account deletion: ${failed} of ${removed.length} photo files could not be removed`);
  return new Response(null, { status: 204 });
});
