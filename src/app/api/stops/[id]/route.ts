import { stopPatchSchema } from "@/lib/validation";
import { handle, HttpError, readJson, requireUserId } from "@/server/http";
import { deleteStop, updateStop } from "@/server/stops";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const userId = await requireUserId();
  const { id } = await params;
  const patch = stopPatchSchema.parse(await readJson(req));
  const stop = await updateStop(userId, id, patch);
  if (!stop) throw new HttpError(404, "Stop not found");
  return Response.json({ stop });
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const userId = await requireUserId();
  const { id } = await params;
  const result = await deleteStop(userId, id);
  if (!result) throw new HttpError(404, "Stop not found");
  return new Response(null, { status: 204 });
});
