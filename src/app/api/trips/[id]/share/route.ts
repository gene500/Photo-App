import { handle, HttpError, requireUserId } from "@/server/http";
import { createShareToken, revokeShareToken } from "@/server/share";

type Ctx = { params: Promise<{ id: string }> };

/** Creates the trip's read-only share link, or returns the existing one. */
export const POST = handle(async (_req: Request, { params }: Ctx) => {
  const userId = await requireUserId();
  const { id } = await params;
  const shareToken = await createShareToken(userId, id);
  if (!shareToken) throw new HttpError(404, "Trip not found");
  return Response.json({ shareToken });
});

/** Revokes the link; the old URL stops working immediately. */
export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const userId = await requireUserId();
  const { id } = await params;
  if (!(await revokeShareToken(userId, id))) throw new HttpError(404, "Trip not found");
  return new Response(null, { status: 204 });
});
