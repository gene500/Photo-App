"use client";

import { useState, type ComponentProps } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { btnGhost, btnPrimary, btnSecondary, inputClass } from "@/components/ui/styles";
import { isDateOnly, shiftDepartAtLocal } from "@/lib/dates";
import type { ExportStop } from "@/lib/export";
import type { LngLat, Trip } from "@/lib/types";
import { inYearRange, type TripPatch } from "@/lib/validation";
import { ExportControl } from "./ExportControl";
import { ShareControl } from "./ShareControl";


export function TripHeader({ trip, onSave, onShareChange, exportData }: { trip: Trip; onSave: (patch: TripPatch) => Promise<void>; onShareChange?: (shareToken: string | null) => void; exportData?: { stops: ExportStop[]; route: LngLat[] | null; pdf?: ComponentProps<typeof ExportControl>["pdf"] } }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(trip.name);
  const [plannedDate, setPlannedDate] = useState(trip.plannedDate);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    setBusy(true);
    setError(null);
    try {
      await onSave(plannedDate === trip.plannedDate ? { name } : { name, plannedDate, ...movedDepartAt() });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the trip");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    // 0.78ch per character: "ch" is the width of a "0", wider than the average letter.
    const nameMin = `${(Math.min(trip.name.trim().length, 7) * 0.78).toFixed(2)}ch`;
    return (
      // The Export/Share popovers anchor to this header (not their own button), so they stay inside the panel.
      <header className="relative">
        {/* One row: the name truncates, the buttons keep their size (tighter padding so a short name stays readable in a narrow sidebar). The buttons only drop to a second line when a long name would get narrower than 7 characters (narrow phone or large text); a shorter name only needs its own length, so it stays on the row. The minimum is in ch so it scales with the text size. */}
        <div className="flex flex-wrap items-start justify-between gap-x-1">
          <h1 title={trip.name} style={{ minWidth: nameMin, flexBasis: nameMin }} className="grow truncate text-lg font-semibold leading-9">{trip.name}</h1>
          <div className="ml-auto flex max-w-full shrink-0 flex-wrap justify-end [&>button]:whitespace-nowrap [&>button]:px-1.5 [&>div>button]:whitespace-nowrap [&>div>button]:px-1.5">
            <button type="button" onClick={beginEdit} className={btnGhost}>Edit trip</button>
            {exportData && <ExportControl tripName={trip.name} plannedDate={trip.plannedDate} stops={exportData.stops} route={exportData.route} pdf={exportData.pdf} />}
            {onShareChange && <ShareControl tripId={trip.id} shareToken={trip.shareToken} onChange={onShareChange} />}
          </div>
        </div>
        <p className="text-sm text-muted">Planned for {trip.plannedDate}</p>
      </header>
    );
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-3 pb-2">
      <label className="block">
        <span className="text-sm text-muted">Trip name</span>
        <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </label>
      <label className="block">
        <span className="text-sm text-muted">Planned date</span>
        <input type="date" required value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} className={inputClass} />
      </label>
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={btnPrimary}>Save trip</button>
        <button type="button" onClick={() => setEditing(false)} className={btnSecondary}>Cancel</button>
      </div>
    </form>
  );
}
