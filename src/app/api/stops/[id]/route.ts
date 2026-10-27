import { enforceLimit } from "@/server/rate-limit";
import { stopPatchSchema } from "@/lib/validation";
import { handle, HttpError, readJson, requireUserId } from "@/server/http";
import { deletePhotoFile } from "@/server/photos";
import { deleteStop, getOwnedStop, swapStopPhoto, updateStopCascade } from "@/server/stops";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const userId = await requireUserId();
  enforceLimit("trip-write", userId);
  const { id } = await params;
  const { photoUrl, ...patch } = stopPatchSchema.parse(await readJson(req));
  const before = photoUrl === null ? await getOwnedStop(userId, id) : null;
  const result = Object.keys(patch).length > 0
    ? await updateStopCascade(userId, id, patch)
    : await getOwnedStop(userId, id).then((stop) => (stop ? { stop, cascaded: [] } : null));
  if (!result) throw new HttpError(404, "Stop not found");
  // Other stops whose visited flag changed with this one (the visited run rule), so the client can show them without guessing.
  const extra = result.cascaded.length > 0 ? { stops: result.cascaded } : {};
  if (photoUrl !== null || !before?.photoUrl) return Response.json({ stop: result.stop, ...extra });
  // Clearing the photo goes through the same compare-and-swap as the photo route, so the old file
  // is deleted exactly when our swap won and never leaked or double-deleted.
  const swap = await swapStopPhoto(userId, id, before.photoUrl, null);
  if (swap.status === "gone" || !swap.stop) throw new HttpError(404, "Stop not found");
  if (swap.status === "swapped") await deletePhotoFile(before.photoUrl);
  return Response.json({ stop: swap.stop, ...extra });
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const userId = await requireUserId();
  enforceLimit("trip-write", userId);
  const { id } = await params;
  const result = await deleteStop(userId, id);
  if (!result) throw new HttpError(404, "Stop not found");
  await deletePhotoFile(result.photoUrl);
  return new Response(null, { status: 204 });
});
