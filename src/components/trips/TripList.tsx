"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { api } from "@/lib/api-client";
import { pruneTripCopies, removeTripCopy } from "@/lib/offline-store";
import type { TripSummary } from "@/lib/types";

export function TripList({ trips }: { trips: TripSummary[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  // Offline copies of trips that no longer exist (deleted here or elsewhere) must not stay readable.
  const idsKey = trips.map((t) => t.id).join(",");
  useEffect(() => pruneTripCopies(idsKey ? idsKey.split(",") : []), [idsKey]);

  async function remove(trip: TripSummary) {
    if (!window.confirm(`Delete "${trip.name}"? This cannot be undone.`)) return;
    try {
      await api.deleteTrip(trip.id);
      removeTripCopy(trip.id);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete the trip");
    }
  }

  if (trips.length === 0) return <p className="text-muted">No trips yet. Create one below.</p>;

  return (
    <div className="space-y-3">
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      <ul className="space-y-3">
        {trips.map((t) => (
          <li key={t.id} className="group flex items-center rounded-2xl bg-surface shadow-sm ring-1 ring-border transition hover:shadow-md">
            {/* The whole row (name and details) is the link; only Delete sits outside it. */}
            <Link href={`/trips/${t.id}`} className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-2xl px-5 py-4 focus-visible:outline-2 focus-visible:outline-accent-strong">
              <span className="truncate font-medium">{t.name}</span>
              <span className="text-sm text-muted">{t.plannedDate} · {t.stopCount} stops</span>
            </Link>
            <button type="button" onClick={() => void remove(t)} aria-label={`Delete ${t.name}`} className="mr-3 min-h-9 shrink-0 rounded-lg px-3 text-sm text-muted transition hover:bg-danger-soft hover:text-danger [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
