import { cache } from "react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { preconnect } from "react-dom";
import { RefreshWhenStale } from "@/components/RefreshWhenStale";
import { TripEditor } from "@/components/editor/TripEditor";
import { loginUrl } from "@/lib/safe-callback";
import { mapLoadState } from "@/server/budget";
import { getCurrentUserId } from "@/server/session";
import { getTrip } from "@/server/trips";

const renderStamp = () => Date.now();

// The page and its metadata both need the trip; React.cache makes that one query per request.
const loadTrip = cache(async (id: string) => {
  const userId = await getCurrentUserId();
  return userId ? { userId, trip: await getTrip(userId, id) } : null;
});

export async function generateMetadata({ params }: PageProps<"/trips/[id]">): Promise<Metadata> {
  const { id } = await params;
  const loaded = await loadTrip(id);
  return { title: loaded?.trip ? `${loaded.trip.name} · Photo Op Planner` : "Photo Op Planner" };
}

export default async function TripPage({ params }: PageProps<"/trips/[id]">) {
  // Open the connection to Mapbox now, while the trip loads, so the map's tiles don't wait on a handshake.
  preconnect("https://api.mapbox.com");
  const { id } = await params;
  const loaded = await loadTrip(id);
  if (!loaded) redirect(loginUrl(`/trips/${encodeURIComponent(id)}`));
  const { userId, trip } = loaded;
  if (!trip) notFound();
  const renderedAt = renderStamp();
  // Signed-in users keep the map until 95% of the month's allowance; from 70% they get a heads-up banner. Fails open (see mapLoadState).
  const mapState = await mapLoadState();
  // Back/Forward can restore a cached copy of this page; RefreshWhenStale then fetches a fresh one. The editor stays mounted
  // and merges the fresher data into its live state (see TripEditor), so typed text, open forms and requests in flight survive.
  return (
    <>
      <RefreshWhenStale renderedAt={renderedAt} />
      <TripEditor initialTrip={trip} userId={userId} mapAllowed={mapState !== "all-off"} mapUsageHigh={mapState !== "ok"} />
    </>
  );
}
