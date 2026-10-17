import { enforceLimit } from "@/server/rate-limit";
import { tripPatchSchema } from "@/lib/validation";
import { handle, HttpError, readJson, requireUserId } from "@/server/http";
import { deletePhotoFile } from "@/server/photos";
import { deleteTrip, DepartAtMismatchError, getTrip, updateTrip } from "@/server/trips";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const userId = await requireUserId();
  const { id } = await params;
  const trip = await getTrip(userId, id);
  if (!trip) throw new HttpError(404, "Trip not found");
  return Response.json({ trip });
});

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const userId = await requireUserId();
  enforceLimit("trip-write", userId);
  const { id } = await params;
  const patch = tripPatchSchema.parse(await readJson(req));
  let trip;
  try {
    trip = await updateTrip(userId, id, patch);
  } catch (e) {
    if (e instanceof DepartAtMismatchError) throw new HttpError(400, e.message);
    throw e;
  }
  if (!trip) throw new HttpError(404, "Trip not found");
  return Response.json({ trip });
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const userId = await requireUserId();
  enforceLimit("trip-write", userId);
  const { id } = await params;
  const result = await deleteTrip(userId, id);
  if (!result) throw new HttpError(404, "Trip not found");
  await Promise.all(result.photoUrls.map((url) => deletePhotoFile(url)));
  return new Response(null, { status: 204 });
});
