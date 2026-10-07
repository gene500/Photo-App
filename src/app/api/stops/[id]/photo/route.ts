import { handle, HttpError, requireUserId } from "@/server/http";
import { deletePhotoFile, savePhoto, validatePhoto } from "@/server/photos";
import { getOwnedStop, updateStop } from "@/server/stops";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (req: Request, { params }: Ctx) => {
  const userId = await requireUserId();
  const { id } = await params;
  const stop = await getOwnedStop(userId, id);
  if (!stop) throw new HttpError(404, "Stop not found");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "Expected a multipart form upload");
  }
  const file = form.get("photo");
  if (!(file instanceof File)) throw new HttpError(400, "No photo provided");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validatePhoto(file, bytes);
  if (!check.ok) throw new HttpError(400, check.error);

  const photoUrl = await savePhoto(bytes, check.type);
  const updated = await updateStop(userId, id, { photoUrl });
  if (!updated) {
    // The stop was deleted while we were saving: don't leave the new file orphaned.
    await deletePhotoFile(photoUrl);
    throw new HttpError(404, "Stop not found");
  }
  await deletePhotoFile(stop.photoUrl);
  return Response.json({ stop: updated });
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const userId = await requireUserId();
  const { id } = await params;
  const stop = await getOwnedStop(userId, id);
  if (!stop) throw new HttpError(404, "Stop not found");
  const updated = await updateStop(userId, id, { photoUrl: null });
  if (!updated) throw new HttpError(404, "Stop not found");
  await deletePhotoFile(stop.photoUrl);
  return Response.json({ stop: updated });
});
