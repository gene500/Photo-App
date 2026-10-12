import { tripInputSchema } from "@/lib/validation";
import { handle, HttpError, readJson, requireUserId } from "@/server/http";
import { enforceLimit } from "@/server/rate-limit";
import { createTrip, listTrips, TooManyTripsError } from "@/server/trips";

export const GET = handle(async () => {
  const userId = await requireUserId();
  return Response.json({ trips: await listTrips(userId) });
});

export const POST = handle(async (req: Request) => {
  const userId = await requireUserId();
  enforceLimit("trip-write", userId);
  const input = tripInputSchema.parse(await readJson(req));
  try {
    return Response.json({ trip: await createTrip(userId, input) }, { status: 201 });
  } catch (e) {
    if (e instanceof TooManyTripsError) throw new HttpError(400, e.message);
    throw e;
  }
});
