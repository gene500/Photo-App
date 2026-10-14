import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { SharedTripView } from "@/components/share/SharedTripView";
import type { RouteResult } from "@/lib/types";
import { enforceLimit } from "@/server/rate-limit";
import { getDirections } from "@/server/external/mapbox";
import { getSharedTrip } from "@/server/share";

// A revoked link must stop working immediately, so this page is never cached or prerendered.
export const dynamic = "force-dynamic";

// Page and metadata both need the trip; React.cache makes that one query per request.
const load = cache(getSharedTrip);

const PRIVATE: Pick<Metadata, "robots" | "referrer"> = {
  robots: { index: false, follow: false },
  // The token lives in the URL, so never leak it to third parties (map tiles, links) via Referer.
  referrer: "no-referrer",
};

export async function generateMetadata({ params }: PageProps<"/s/[token]">): Promise<Metadata> {
  const { token } = await params;
  const trip = await load(token);
  return { ...PRIVATE, title: trip ? `${trip.name} · Photo Op Planner` : "Not found" };
}

/** The real driving route, fetched here because the directions API needs a login. Null (straight line) on any failure. */
async function routeFor(token: string, stops: { lng: number; lat: number }[]): Promise<RouteResult | null> {
  if (stops.length < 2) return null;
  try {
    enforceLimit("directions", `share:${token}`);
    return await getDirections(stops.map((s) => [s.lng, s.lat]));
  } catch {
    return null;
  }
}

/** Public, login-free, read-only view of a shared trip. */
export default async function SharedTripPage({ params }: PageProps<"/s/[token]">) {
  const { token } = await params;
  const trip = await load(token);
  if (!trip) notFound();
  return <SharedTripView trip={trip} route={await routeFor(token, trip.stops)} />;
}
