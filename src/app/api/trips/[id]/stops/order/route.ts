import { enforceLimit } from "@/server/rate-limit";
import { reorderSchema } from "@/lib/validation";
import { handle, HttpError, readJson, requireUserId } from "@/server/http";
import { InvalidReorderError, reorderStops, StopsChangedError } from "@/server/stops";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = handle(async (req: Request, { params }: Ctx) => {
  const userId = await requireUserId();
  enforceLimit("trip-write", userId);
  const { id } = await params;
  const { stopIds } = reorderSchema.parse(await readJson(req));
  try {
    const stops = await reorderStops(userId, id, stopIds);
    if (!stops) throw new HttpError(404, "Trip not found");
    return Response.json({ stops });
  } catch (e) {
    if (e instanceof InvalidReorderError) throw new HttpError(400, e.message);
    if (e instanceof StopsChangedError) throw new HttpError(409, e.message);
    throw e;
  }
});
