import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { SharedTripView } from "@/components/share/SharedTripView";
import { getSharedTrip } from "@/server/share";

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
  return { ...PRIVATE, title: trip ? `${trip.name} · Road Trip Photo Planner` : "Not found" };
}

/** Public, login-free, read-only view of a shared trip. */
export default async function SharedTripPage({ params }: PageProps<"/s/[token]">) {
  const { token } = await params;
  const trip = await load(token);
  if (!trip) notFound();
  return <SharedTripView trip={trip} />;
}
