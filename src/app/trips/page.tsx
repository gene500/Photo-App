import { redirect } from "next/navigation";
import { NewTripForm } from "@/components/trips/NewTripForm";
import { TripList } from "@/components/trips/TripList";
import { getCurrentUserId } from "@/server/session";
import { listTrips } from "@/server/trips";

export default async function TripsPage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
  const trips = await listTrips(userId);
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4">
      <h1 className="text-2xl font-semibold">Your trips</h1>
      <TripList trips={trips} />
      <NewTripForm />
    </main>
  );
}
