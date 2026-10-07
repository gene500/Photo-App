import { newStopSchema } from "@/lib/validation";
import { handle, HttpError, readJson, requireUserId } from "@/server/http";
import { addStop } from "@/server/stops";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (req: Request, { params }: Ctx) => {
  const userId = await requireUserId();
  const { id } = await params;
  const input = newStopSchema.parse(await readJson(req));
  const stop = await addStop(userId, id, input);
  if (!stop) throw new HttpError(404, "Trip not found");
  return Response.json({ stop }, { status: 201 });
});
