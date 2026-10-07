import { handle, HttpError, requireUserId } from "@/server/http";
import { isValidPhotoName, PHOTO_URL_PREFIX, readPhoto } from "@/server/photos";
import { findStopByPhotoUrl } from "@/server/stops";

type Ctx = { params: Promise<{ name: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const userId = await requireUserId();
  const { name } = await params;
  if (!isValidPhotoName(name)) throw new HttpError(404, "Not found");
  if (!(await findStopByPhotoUrl(userId, `${PHOTO_URL_PREFIX}${name}`))) {
    throw new HttpError(404, "Not found");
  }
  const photo = await readPhoto(name);
  if (!photo) throw new HttpError(404, "Not found");
  return new Response(new Uint8Array(photo.bytes), {
    headers: { "Content-Type": photo.contentType, "Cache-Control": "private, max-age=3600" },
  });
});
