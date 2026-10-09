import { MAX_PHOTO_BYTES } from "@/lib/photo-rules";
import { enforceLimit } from "@/server/rate-limit";
import { handle, HttpError, readBodyBytes, requireUserId } from "@/server/http";
import { deletePhotoFile, savePhoto, validatePhoto } from "@/server/photos";
import { getOwnedStop, swapStopPhoto } from "@/server/stops";

type Ctx = { params: Promise<{ id: string }> };

/** Multipart framing around the file; anything bigger than file cap + this is refused before it is buffered. */
const FORM_OVERHEAD_BYTES = 64 * 1024;

export const POST = handle(async (req: Request, { params }: Ctx) => {
  const userId = await requireUserId();
  enforceLimit("photo-upload", userId);
  const { id } = await params;
  const stop = await getOwnedStop(userId, id);
  if (!stop) throw new HttpError(404, "Stop not found");

  let form: FormData;
  // The size cap is checked on the raw bytes (Content-Length first, then while streaming), before any parsing.
  const raw = await readBodyBytes(req, MAX_PHOTO_BYTES + FORM_OVERHEAD_BYTES);
  try {
    form = await new Response(raw as BodyInit, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
  } catch {
    throw new HttpError(400, "Expected a multipart form upload");
  }
  const file = form.get("photo");
  if (!(file instanceof File)) throw new HttpError(400, "No photo provided");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validatePhoto(file, bytes);
  if (!check.ok) throw new HttpError(400, check.error);

  const photoUrl = await savePhoto(bytes, check.type);
  const swap = await swapStopPhoto(userId, id, stop.photoUrl, photoUrl);
  if (swap.status === "gone") {
    // The stop was deleted while we were saving: don't leave the new file orphaned.
    await deletePhotoFile(photoUrl);
    throw new HttpError(404, "Stop not found");
  }
  if (swap.status === "conflict") {
    // A concurrent upload/removal won the swap: discard our file and report the current stop.
    await deletePhotoFile(photoUrl);
    return Response.json({ stop: swap.stop });
  }
  await deletePhotoFile(stop.photoUrl);
  if (!swap.stop) throw new HttpError(404, "Stop not found"); // deleted right after our swap
  return Response.json({ stop: swap.stop });
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const userId = await requireUserId();
  const { id } = await params;
  const stop = await getOwnedStop(userId, id);
  if (!stop) throw new HttpError(404, "Stop not found");
  const swap = await swapStopPhoto(userId, id, stop.photoUrl, null);
  if (swap.status === "gone") throw new HttpError(404, "Stop not found");
  // Only delete the old file if our swap won; otherwise someone else already owns its cleanup.
  if (swap.status === "swapped") await deletePhotoFile(stop.photoUrl);
  if (!swap.stop) throw new HttpError(404, "Stop not found");
  return Response.json({ stop: swap.stop });
});
