import { stopPatchSchema } from "@/lib/validation";
import { handle, HttpError, readJson, requireUserId } from "@/server/http";
import { deletePhotoFile } from "@/server/photos";
import { deleteStop, getOwnedStop, swapStopPhoto, updateStop } from "@/server/stops";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const userId = await requireUserId();
  const { id } = await params;
  const { photoUrl, ...patch } = stopPatchSchema.parse(await readJson(req));
  const before = photoUrl === null ? await getOwnedStop(userId, id) : null;
  const updated = Object.keys(patch).length > 0 ? await updateStop(userId, id, patch) : await getOwnedStop(userId, id);
  if (!updated) throw new HttpError(404, "Stop not found");
  if (photoUrl !== null || !before?.photoUrl) return Response.json({ stop: updated });
  // Clearing the photo goes through the same compare-and-swap as the photo route, so the old file
  // is deleted exactly when our swap won and never leaked or double-deleted.
  const swap = await swapStopPhoto(userId, id, before.photoUrl, null);
  if (swap.status === "gone" || !swap.stop) throw new HttpError(404, "Stop not found");
  if (swap.status === "swapped") await deletePhotoFile(before.photoUrl);
  return Response.json({ stop: swap.stop });
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const userId = await requireUserId();
  const { id } = await params;
  const result = await deleteStop(userId, id);
  if (!result) throw new HttpError(404, "Stop not found");
  await deletePhotoFile(result.photoUrl);
  return new Response(null, { status: 204 });
});
