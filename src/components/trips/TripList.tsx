"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { api } from "@/lib/api-client";
import { pruneTripCopies, removeTripCopy } from "@/lib/offline-store";
import type { TripSummary } from "@/lib/types";

export function TripList({ trips }: { trips: TripSummary[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  // A second click while a delete is in flight must not send another request (or show another confirm).
  const inFlight = useRef(new Set<string>());
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(new Set());
  const markDeleting = () => setDeleting(new Set(inFlight.current));

  // Offline copies of trips that no longer exist (deleted here or elsewhere) must not stay readable.
  const idsKey = trips.map((t) => t.id).join(",");
  useEffect(() => pruneTripCopies(idsKey ? idsKey.split(",") : []), [idsKey]);

  async function remove(trip: TripSummary) {
    if (inFlight.current.has(trip.id)) return;
    if (!window.confirm(`Delete "${trip.name}"? This cannot be undone.`)) return;
    inFlight.current.add(trip.id);
    markDeleting();
    try {
      await api.deleteTrip(trip.id);
      removeTripCopy(trip.id);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete the trip");
    } finally {
      inFlight.current.delete(trip.id);
      markDeleting();
    }
  }

  if (trips.length === 0) return <p className="text-muted">No trips yet. Create one below.</p>;

  return (
    <div className="space-y-3">
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      <ul className="space-y-3">
        {trips.map((t) => (
          <li key={t.id} className="anim-rise lift group flex items-center rounded-2xl bg-surface shadow-sm ring-1 ring-border">
            {/* The whole row (name and details) is the link; only Delete sits outside it. */}
            <Link href={`/trips/${t.id}`} className="flex min-w-0 flex-1 items-center gap-4 rounded-2xl px-4 py-3.5 focus-visible:outline-2 focus-visible:outline-accent-strong">
              <DateStub iso={t.plannedDate} />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-display truncate text-lg font-semibold">{t.name}</span>
                <span className="text-sm text-muted">{t.stopCount} stops</span>
              </span>
            </Link>
            <button type="button" disabled={deleting.has(t.id)} onClick={() => void remove(t)} aria-label={`Delete ${t.name}`} className="mr-3 min-h-9 shrink-0 rounded-lg px-3 text-sm text-muted transition hover:bg-danger-soft hover:text-danger disabled:opacity-50 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Month over day-of-month, read from the YYYY-MM-DD string so the time zone can't shift it. */
function DateStub({ iso }: { iso: string }) {
  const [y, m, d] = iso.split("-");
  const month = MONTHS[Number(m) - 1];
  if (!month || !y || !d) return null;
  return (
    <time dateTime={iso} title={iso} className="flex h-14 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-accent-soft text-accent-strong">
      <span className="text-xs leading-none">{month}</span>
      <span className="font-display text-xl font-semibold leading-tight">{Number(d)}</span>
    </time>
  );
}
