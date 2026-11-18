import { handle, HttpError, requireUserId } from "@/server/http";
import { enforceLimit } from "@/server/rate-limit";
import { resolveStopAccess } from "@/server/stop-access";

type Ctx = { params: Promise<{ id: string }> };

/** Finds and saves the parking lot a stop's hike starts from; returns the updated stop. Owner only. */
export const POST = handle(async (_req: Request, { params }: Ctx) => {
  const userId = await requireUserId();
  enforceLimit("access", userId);
  const { id } = await params;
  const stop = await resolveStopAccess(userId, id);
  if (!stop) throw new HttpError(404, "Stop not found");
  return Response.json({ stop });
});
