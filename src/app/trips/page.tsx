import { redirect } from "next/navigation";
import { RefreshWhenStale } from "@/components/RefreshWhenStale";
import { NewTripForm } from "@/components/trips/NewTripForm";
import { TripMapBackdrop } from "@/components/trips/TripMapBackdrop";
import { TripList } from "@/components/trips/TripList";
import { getCurrentUserId } from "@/server/session";
import { listTrips } from "@/server/trips";

const renderStamp = () => Date.now();

export default async function TripsPage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
  const trips = await listTrips(userId);
  const renderedAt = renderStamp();
  return (
    <div className="relative isolate min-h-[calc(100vh-3rem)] overflow-hidden">
      <RefreshWhenStale renderedAt={renderedAt} />
      <TripMapBackdrop />
      <main id="main-content" tabIndex={-1} className="outline-none mx-auto max-w-2xl space-y-8 px-4 py-10">
        <h1 tabIndex={-1} className="text-2xl font-semibold outline-none">Your trips</h1>
        <TripList trips={trips} renderedAt={renderedAt} />
        <NewTripForm />
      </main>
    </div>
  );
}
