"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useSettings } from "@/components/settings/SettingsProvider";
import { btnGhost, card } from "@/components/ui/styles";
import { computeBestTimes, describeBestTime, formatClock, tripDeparture } from "@/lib/best-time";
import { lightLabel } from "@/lib/light-windows";
import { listTripCopies, loadTripCopy } from "@/lib/offline-store";
import { stopColor } from "@/lib/stop-style";

const noop = () => {};
const subscribeNever = () => noop;

/** The saved index as a raw string: a stable snapshot for useSyncExternalStore, refreshed when another tab writes. */
function subscribeStorage(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}
const indexSnapshot = () => JSON.stringify(listTripCopies());

/** Read-only list of the trips saved on this device. No map (map tiles cannot be stored) and no network. */
export function OfflineView() {
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  const rawIndex = useSyncExternalStore(subscribeStorage, indexSnapshot, () => "[]");
  const summaries = useMemo(() => JSON.parse(rawIndex) as ReturnType<typeof listTripCopies>, [rawIndex]);
  const [openId, setOpenId] = useState<string | null>(null);
  const copy = useMemo(() => (openId ? loadTripCopy(openId) : null), [openId]);

  return (
    <main className="mx-auto w-full max-w-2xl space-y-4 px-4 py-8">
      <header className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Road Trip Photo Planner</p>
        <h1 className="text-2xl font-semibold tracking-tight">{copy ? copy.trip.name : "Saved trips"}</h1>
      </header>

      {!mounted ? null : copy ? (
        <TripCopyView copy={copy} onBack={() => setOpenId(null)} />
      ) : summaries.length === 0 ? (
        <p className={`${card} p-4 text-sm text-muted`}>
          No trips are saved on this device yet. Open a trip while you are online and a read-only copy is kept here.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">Read-only copies saved on this device. Reconnect to edit.</p>
          <ul className="space-y-2">
            {summaries.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => setOpenId(s.id)} className={`${card} flex w-full items-center justify-between gap-3 p-4 text-left transition hover:bg-hover`}>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{s.name}</span>
                    <span className="block text-xs text-muted">
                      {s.plannedDate} · {s.stopCount} {s.stopCount === 1 ? "stop" : "stops"} · saved {new Date(s.savedAt).toLocaleDateString()}
                    </span>
                  </span>
                  <span aria-hidden className="text-muted">›</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

function TripCopyView({ copy, onBack }: { copy: NonNullable<ReturnType<typeof loadTripCopy>>; onBack: () => void }) {
  const { trip } = copy;
  const { settings } = useSettings();
  const tf = settings.timeFormat;
  // No route durations offline, so arrival times are unknown: each stop shows its best light window for the planned date.
  const bestTimes = useMemo(() => computeBestTimes({ plannedDate: trip.plannedDate, departAt: trip.departAt, stops: trip.stops }, null), [trip]);
  const departs = trip.stops.length > 0 ? tripDeparture({ plannedDate: trip.plannedDate, departAt: trip.departAt, stops: trip.stops }) : null;

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className={btnGhost}>‹ All saved trips</button>
      <p role="status" className="rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent-foreground dark:text-foreground">
        You&apos;re offline - showing your saved copy from {new Date(copy.savedAt).toLocaleString()}
      </p>
      <p className="text-sm text-muted">
        Planned for {trip.plannedDate}
        {departs && <> · Leaves {trip.departAt ? "" : "~"}{formatClock(departs, undefined, tf)}</>}
      </p>
      {trip.stops.length === 0 ? (
        <p className="text-sm text-muted">This trip has no stops.</p>
      ) : (
        <ol className="space-y-2">
          {trip.stops.map((s, i) => (
            <li key={s.id} data-testid="offline-stop" className={`${card} flex items-start gap-3 p-3`}>
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${s.visited ? "text-black/75" : "text-white"}`}
                style={{ background: stopColor(s) }}
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-sm font-medium leading-7">
                  {s.name}
                  {s.visited && <span className="ml-2 text-xs font-normal text-muted">Visited</span>}
                </p>
                <p className="text-xs text-muted">
                  {describeBestTime(bestTimes[i] ?? null, undefined, tf)}
                  {s.dwellMinutes > 0 && <> · Stay {s.dwellMinutes} min</>}
                </p>
                {s.lightPref !== "any" && <p className="text-xs text-muted">Best at {lightLabel(s.lightPref).toLowerCase()}</p>}
                {s.notes && <p className="whitespace-pre-wrap text-xs">{s.notes}</p>}
                {s.shotNotes && <p className="whitespace-pre-wrap text-xs">{s.shotNotes}</p>}
                {s.shotChecklist.length > 0 && (
                  <ul className="space-y-0.5 text-xs">
                    {s.shotChecklist.map((item, j) => (
                      <li key={j} className={item.done ? "text-muted line-through" : ""}>
                        <span aria-hidden>{item.done ? "☑" : "☐"}</span> {item.text}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="text-xs text-muted">Drive times need a connection, so they are left out. The map is not available offline.</p>
    </div>
  );
}
