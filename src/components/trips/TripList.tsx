"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { isKnownFresh } from "@/components/RefreshWhenStale";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { ApiError, api } from "@/lib/api-client";
import { pruneTripCopies, removeTripCopy } from "@/lib/offline-store";
import { focusFirst, softDisabled } from "@/lib/focus";
import type { TripSummary } from "@/lib/types";

export function TripList({ trips, renderedAt }: { trips: TripSummary[]; /** The page render this list came from; copies are pruned only when it is known to be current. Omitted: always current. */ renderedAt?: number }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [error, setError] = useState<string | null>(null);
  // A second click while a delete is in flight must not send another request (or show another confirm).
  const inFlight = useRef(new Set<string>());
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(new Set());
  // Each row's link, so focus can move to a neighbour when its row is deleted.
  const listRef = useRef<HTMLUListElement>(null);
  const markDeleting = () => setDeleting(new Set(inFlight.current));

  // Offline copies of trips that no longer exist (deleted here or elsewhere) must not stay readable.
  const idsKey = trips.map((t) => t.id).join(",");
  // Only on a render known to be fresh: Back first shows a cached list that lacks trips made since, and pruning by it would delete their copies.
  useEffect(() => {
    if (renderedAt !== undefined && !isKnownFresh(renderedAt)) return;
    pruneTripCopies(idsKey ? idsKey.split(",") : []);
  }, [idsKey, renderedAt]);

  async function remove(trip: TripSummary) {
    if (inFlight.current.has(trip.id)) return;
    if (!(await confirm({ title: "Delete trip?", message: `Delete "${trip.name}"? This cannot be undone.`, confirmLabel: "Delete" }))) return;
    if (inFlight.current.has(trip.id)) return;
    inFlight.current.add(trip.id);
    markDeleting();
    try {
      try {
        await api.deleteTrip(trip.id);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e; // already deleted elsewhere: same end result
      }
      removeTripCopy(trip.id);
      try { window.localStorage.removeItem(`autoFirstStop:${trip.id}`); } catch { /* storage unavailable */ }
      // The row is about to go: keep keyboard focus on the next row, else the previous one, else the page heading.
      const at = trips.findIndex((t) => t.id === trip.id);
      const near = [trips[at + 1], trips[at - 1]].map((t) => (t ? listRef.current?.querySelector<HTMLElement>(`[data-trip-link="${t.id}"]`) : null));
      focusFirst(...near, document.querySelector<HTMLElement>("main h1"));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete the trip");
    } finally {
      inFlight.current.delete(trip.id);
      markDeleting();
    }
  }

  if (trips.length === 0) return <p className="rounded-2xl bg-surface px-4 py-5 text-center text-muted shadow-sm ring-1 ring-border">No trips yet. Create one below.</p>;

  return (
    <div className="space-y-3">
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      <ul ref={listRef} className="space-y-3">
        {trips.map((t) => (
          <li key={t.id} className="anim-rise lift group flex items-center rounded-2xl bg-surface shadow-sm ring-1 ring-border">
            {/* The whole row (name and details) is the link; only Delete sits outside it. */}
            <Link data-trip-link={t.id} href={`/trips/${t.id}`} className="flex min-w-0 flex-1 items-center gap-4 rounded-2xl px-4 py-3.5 focus-visible:outline-2 focus-visible:outline-accent-strong">
              <DateStub iso={t.plannedDate} />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span title={t.name} className="font-display line-clamp-2 break-words text-lg font-semibold">{t.name}</span>
                <span className="text-sm text-muted">{t.stopCount} stops</span>
              </span>
            </Link>
            <button type="button" {...softDisabled(deleting.has(t.id))} onClick={deleting.has(t.id) ? undefined : () => void remove(t)} aria-label={`Delete ${t.name}`} className="mr-3 min-h-9 shrink-0 rounded-lg px-3 text-sm text-muted transition hover:bg-danger-soft hover:text-danger aria-disabled:opacity-50 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
              Delete
            </button>
          </li>
        ))}
      </ul>
      {dialog}
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
