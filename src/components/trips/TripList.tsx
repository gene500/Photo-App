"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { api } from "@/lib/api-client";
import type { TripSummary } from "@/lib/types";

export function TripList({ trips }: { trips: TripSummary[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function remove(trip: TripSummary) {
    if (!window.confirm(`Delete "${trip.name}"? This cannot be undone.`)) return;
    try {
      await api.deleteTrip(trip.id);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete the trip");
    }
  }

  if (trips.length === 0) return <p className="text-gray-600">No trips yet. Create one below.</p>;

  return (
    <div className="space-y-2">
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      <ul className="divide-y rounded border">
        {trips.map((t) => (
          <li key={t.id} className="flex items-stretch">
            {/* The whole row (name and details) is the link; only Delete sits outside it. */}
            <Link href={`/trips/${t.id}`} className="flex flex-1 items-center justify-between gap-3 px-3 py-3 hover:bg-gray-50">
              <span className="font-medium">{t.name}</span>
              <span className="text-sm text-gray-600">{t.plannedDate} · {t.stopCount} stops</span>
            </Link>
            <button type="button" onClick={() => void remove(t)} aria-label={`Delete ${t.name}`} className="px-4 text-sm text-red-700 hover:bg-red-50">
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
