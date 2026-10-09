import { weatherBatchSchema } from "@/lib/validation";
import { getForecasts } from "@/server/external/weather";
import { handle, readJson, requireUserId } from "@/server/http";
import { enforceLimit } from "@/server/rate-limit";

/** Weather for up to 10 places on one date (suggestion cards); one upstream request serves the whole batch. */
export const POST = handle(async (req: Request) => {
  const userId = await requireUserId();
  enforceLimit("weather-batch", userId);
  const { date, points } = weatherBatchSchema.parse(await readJson(req));
  return Response.json({ forecasts: await getForecasts(points, date) });
});
