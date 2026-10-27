import { createHash } from "node:crypto";
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
  // Back/Forward can restore a cached copy of this page; RefreshWhenStale then fetches a fresh one. The editor reads
  // initialTrip only on mount, so it is keyed on the trip's content: it remounts (rebuilding the map) only when the
  // refreshed data really differs, never just because the render was repeated.
  const version = createHash("sha1").update(JSON.stringify(trip)).digest("hex");
  return (
    <>
      <RefreshWhenStale renderedAt={renderedAt} />
      <TripEditor key={version} initialTrip={trip} userId={userId} />
    </>
  );
}
