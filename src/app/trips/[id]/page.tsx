import { notFound, redirect } from "next/navigation";
import { preconnect } from "react-dom";
import { TripEditor } from "@/components/editor/TripEditor";
import { getCurrentUserId } from "@/server/session";
import { getTrip } from "@/server/trips";

export default async function TripPage({ params }: PageProps<"/trips/[id]">) {
  // Open the connection to Mapbox now, while the trip loads, so the map's tiles don't wait on a handshake.
  preconnect("https://api.mapbox.com");
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
  const { id } = await params;
  const trip = await getTrip(userId, id);
  if (!trip) notFound();
  return <TripEditor initialTrip={trip} userId={userId} />;
}
