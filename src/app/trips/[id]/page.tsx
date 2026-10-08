import { notFound, redirect } from "next/navigation";
import { TripEditor } from "@/components/editor/TripEditor";
import { getCurrentUserId } from "@/server/session";
import { getTrip } from "@/server/trips";

export default async function TripPage({ params }: PageProps<"/trips/[id]">) {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
  const { id } = await params;
  const trip = await getTrip(userId, id);
  if (!trip) notFound();
  return <TripEditor initialTrip={trip} userId={userId} />;
}
