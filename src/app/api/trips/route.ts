import { tripInputSchema } from "@/lib/validation";
import { handle, readJson, requireUserId } from "@/server/http";
import { createTrip, listTrips } from "@/server/trips";

export const GET = handle(async () => {
  const userId = await requireUserId();
  return Response.json({ trips: await listTrips(userId) });
});

export const POST = handle(async (req: Request) => {
  const userId = await requireUserId();
  const input = tripInputSchema.parse(await readJson(req));
  return Response.json({ trip: await createTrip(userId, input) }, { status: 201 });
});
