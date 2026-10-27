import { notFound, redirect } from "next/navigation";
import { preconnect } from "react-dom";
import { RefreshWhenStale } from "@/components/RefreshWhenStale";
import { TripEditor } from "@/components/editor/TripEditor";
import { getCurrentUserId } from "@/server/session";
import { getTrip } from "@/server/trips";

const renderStamp = () => Date.now();

export default async function TripPage({ params }: PageProps<"/trips/[id]">) {
  // Open the connection to Mapbox now, while the trip loads, so the map's tiles don't wait on a handshake.
  preconnect("https://api.mapbox.com");
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
  const { id } = await params;
  const trip = await getTrip(userId, id);
  if (!trip) notFound();
  const renderedAt = renderStamp();
  // Back/Forward can restore a cached copy of this page; RefreshWhenStale then fetches a fresh one. The editor stays mounted
  // and merges the fresher data into its live state (see TripEditor), so typed text, open forms and requests in flight survive.
  return (
    <>
      <RefreshWhenStale renderedAt={renderedAt} />
      <TripEditor initialTrip={trip} userId={userId} />
    </>
  );
}
