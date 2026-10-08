import { weatherQuerySchema } from "@/lib/validation";
import { handle, requireUserId } from "@/server/http";
import { getForecast } from "@/server/external/weather";

export const GET = handle(async (req: Request) => {
  await requireUserId();
  const params = new URL(req.url).searchParams;
  const q = weatherQuerySchema.parse({
    lat: params.get("lat") ?? undefined,
    lng: params.get("lng") ?? undefined,
    date: params.get("date") ?? undefined,
  });
  // Weather is decorative: failures are a 200 "unavailable". Browser cache: 30 min for a forecast, 5 min otherwise.
  const forecast = await getForecast(q.lat, q.lng, q.date);
  return Response.json({ forecast }, { headers: { "Cache-Control": `private, max-age=${forecast.available ? 1800 : 300}` } });
});
