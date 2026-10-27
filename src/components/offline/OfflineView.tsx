"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useSettings } from "@/components/settings/SettingsProvider";
import { btnGhost, card } from "@/components/ui/styles";
import { computeBestTimes, describeBestTime, formatClock, tripDeparture } from "@/lib/best-time";
import { formatSavedAt } from "@/lib/format";
import { lightLabel } from "@/lib/light-windows";
import { listTripCopies, loadTripCopy } from "@/lib/offline-store";
import { checkOfflineAccess } from "@/lib/offline-gate";
import { goToLogin, reloadPage } from "@/lib/reload";
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
  // This shell is public and static, so nothing is shown until the copies are confirmed to belong to whoever is here.
  const [access, setAccess] = useState<"checking" | "show">("checking");
  useEffect(() => {
    let live = true;
    void checkOfflineAccess().then((verdict) => {
      if (!live) return;
      if (verdict === "login") goToLogin();
      else setAccess("show");
    });
    return () => {
      live = false;
    };
  }, []);
  const rawIndex = useSyncExternalStore(subscribeStorage, indexSnapshot, () => "[]");
  const summaries = useMemo(() => JSON.parse(rawIndex) as ReturnType<typeof listTripCopies>, [rawIndex]);
  const [openId, setOpenId] = useState<string | null>(null);
  // The worker serves this shell at /trips, /login etc. while offline, so it must offer a way back once the network returns.
  const [backOnline, setBackOnline] = useState(false);
  useEffect(() => {
    const on = () => setBackOnline(true);
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, []);
  const copy = useMemo(() => (openId ? loadTripCopy(openId) : null), [openId]);

  return (
    <>
    <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:ring-2 focus:ring-accent-strong">Skip to content</a>
    <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-2xl space-y-4 px-4 py-8 outline-none">
      <header className="space-y-1">
        <h1 className="break-words text-2xl font-semibold">{copy && access === "show" ? copy.trip.name : "Saved trips"}</h1>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={reloadPage} className={btnGhost}>Try again</button>
        <p aria-live="polite" className="text-sm text-muted">{backOnline ? "You're back online. Reload to continue." : ""}</p>
      </div>

      {!mounted || access !== "show" ? null : copy ? (
        <TripCopyView copy={copy} onBack={() => setOpenId(null)} online={backOnline || navigator.onLine} />
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
                    <span className="block break-words font-medium">{s.name}</span>
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
    </>
  );
}

function TripCopyView({ copy, onBack, online }: { copy: NonNullable<ReturnType<typeof loadTripCopy>>; onBack: () => void; online: boolean }) {
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
        {online ? "Showing your saved copy from " : "You're offline - showing your saved copy from "}{formatSavedAt(copy.savedAt, tf)}
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
                <p className="break-words text-sm font-medium leading-7">
                  {s.name}
                  {s.visited && <span className="ml-2 text-xs font-normal text-muted">Visited</span>}
                </p>
                <p className="text-xs text-muted">
                  {describeBestTime(bestTimes[i] ?? null, undefined, tf)}
                  {s.dwellMinutes > 0 && <> · Stay {s.dwellMinutes} min</>}
                </p>
                {s.lightPref !== "any" && <p className="text-xs text-muted">Best at {lightLabel(s.lightPref).toLowerCase()}</p>}
                {s.notes && <p className="whitespace-pre-wrap break-words text-xs">{s.notes}</p>}
                {s.shotNotes && <p className="whitespace-pre-wrap break-words text-xs">{s.shotNotes}</p>}
                {s.shotChecklist.length > 0 && (
                  <ul className="space-y-0.5 break-words text-xs">
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
