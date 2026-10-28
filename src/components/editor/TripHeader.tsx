"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { btnGhost, btnPrimary, btnSecondary, inputClass } from "@/components/ui/styles";
import { softDisabled } from "@/lib/focus";
import { isDateOnly, shiftDepartAtLocal } from "@/lib/dates";
import type { ExportStop } from "@/lib/export";
import type { LngLat, Trip } from "@/lib/types";
import { inYearRange, type TripPatch } from "@/lib/validation";
import { HeaderButtonLabel } from "./HeaderButtonLabel";
import { ExportControl } from "./ExportControl";
import { ShareControl } from "./ShareControl";


export function TripHeader({ trip, onSave, onShareChange, exportData }: { trip: Trip; onSave: (patch: TripPatch) => Promise<void>; onShareChange?: (shareToken: string | null) => void; exportData?: { stops: ExportStop[]; route: LngLat[] | null; pdf?: ComponentProps<typeof ExportControl>["pdf"] } }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(trip.name);
  const [plannedDate, setPlannedDate] = useState(trip.plannedDate);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The Edit button and the form swap places, so focus follows: into the name field on Edit, back to Edit on Save or Cancel.
  const editRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing) nameRef.current?.focus();
    else if (wasEditing.current) editRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  function beginEdit() {
    setName(trip.name);
    setPlannedDate(trip.plannedDate);
    setError(null);
    setEditing(true);
  }

  // The server does not know the viewer's time zone, so the moved start time (same clock time, across any daylight-saving change) is computed here.
  function movedDepartAt(): { departAt?: string } {
    if (!trip.departAt || !isDateOnly(plannedDate) || Number.isNaN(Date.parse(trip.departAt))) return {};
    const departAt = shiftDepartAtLocal(trip.departAt, trip.plannedDate, plannedDate);
    return inYearRange(Date.parse(departAt)) ? { departAt } : {}; // out of range: the server drops the start time
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Only what changed is sent, so a date-only edit in a stale tab cannot undo a rename made elsewhere.
      const patch: TripPatch = {
        ...(name !== trip.name && { name }),
        ...(plannedDate !== trip.plannedDate && { plannedDate, ...movedDepartAt() }),
      };
      if (Object.keys(patch).length > 0) await onSave(patch);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the trip");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    // 0.78ch per character: "ch" is the width of a "0", wider than the average letter.
    const nameMin = `${(Math.min(trip.name.trim().length, 12) * 0.78).toFixed(2)}ch`;
    return (
      // The Export/Share popovers anchor to this header (not their own button), so they stay inside the panel.
      <header className="relative">
        {/* One row: a long name wraps onto more lines (never cut with an ellipsis), the buttons keep their size (tighter padding so a short name stays readable in a narrow sidebar). The buttons only drop to a second line when a long name would get narrower than 12 characters (so it never shrinks to a sliver) (narrow phone or large text); a shorter name only needs its own length, so it stays on the row. The minimum is in ch so it scales with the text size. */}
        <div className="flex flex-wrap items-start justify-between gap-x-1">
          <h1 title={trip.name} style={{ minWidth: nameMin, flexBasis: nameMin }} className="grow break-words text-2xl font-semibold leading-9">{trip.name}</h1>
          <div className="ml-auto flex max-w-full shrink-0 flex-wrap justify-end [&>button]:whitespace-nowrap [&>button]:px-1.5 [&>div>button]:whitespace-nowrap [&>div>button]:px-1.5 max-[359px]:[&>button]:min-h-11 max-[359px]:[&>button]:w-8 max-[359px]:[&>button]:justify-center max-[359px]:[&>button]:px-0 max-[359px]:[&>div>button]:min-h-11 max-[359px]:[&>div>button]:w-8 max-[359px]:[&>div>button]:justify-center max-[359px]:[&>div>button]:px-0">
            <button type="button" ref={editRef} onClick={beginEdit} aria-label="Edit trip" title="Edit trip" className={btnGhost}><HeaderButtonLabel icon="edit">Edit</HeaderButtonLabel></button>
            {exportData && <ExportControl tripName={trip.name} plannedDate={trip.plannedDate} stops={exportData.stops} route={exportData.route} pdf={exportData.pdf} />}
            {onShareChange && <ShareControl tripId={trip.id} shareToken={trip.shareToken} onChange={onShareChange} />}
          </div>
        </div>
        <p className="text-sm text-muted">Planned for {trip.plannedDate}</p>
      </header>
    );
  }

  return (
    // On phones the form (~324 px) scrolls on its own, so Save stays reachable at the 175 px landscape sheet height (the sheet itself does not scroll its header).
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} onKeyDown={(e) => { if (e.key === "Escape" && !busy) setEditing(false); }} className="-mx-1 space-y-3 px-1 pb-2 max-lg:max-h-[40dvh] max-lg:overflow-y-auto short-landscape:max-h-none short-landscape:overflow-visible">
      <label className="block">
        <span className="text-sm text-muted">Trip name</span>
        <input ref={nameRef} required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </label>
      <label className="block">
        <span className="text-sm text-muted">Planned date</span>
        <input type="date" required value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} className={inputClass} />
      </label>
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      <div className="flex gap-2">
        <button type="submit" {...softDisabled(busy)} className={btnPrimary}>Save trip</button>
        <button type="button" onClick={() => setEditing(false)} className={btnSecondary}>Cancel</button>
      </div>
    </form>
  );
}
