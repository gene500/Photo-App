import { reorderSchema } from "@/lib/validation";
import { handle, HttpError, readJson, requireUserId } from "@/server/http";
import { InvalidReorderError, reorderStops } from "@/server/stops";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = handle(async (req: Request, { params }: Ctx) => {
  const userId = await requireUserId();
  const { id } = await params;
  const { stopIds } = reorderSchema.parse(await readJson(req));
  try {
    const stops = await reorderStops(userId, id, stopIds);
    if (!stops) throw new HttpError(404, "Trip not found");
    return Response.json({ stops });
  } catch (e) {
    if (e instanceof InvalidReorderError) throw new HttpError(400, e.message);
    throw e;
  }
});
