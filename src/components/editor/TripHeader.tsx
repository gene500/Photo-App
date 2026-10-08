"use client";

import { useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { btnGhost, btnPrimary, btnSecondary, inputClass } from "@/components/ui/styles";
import type { Trip } from "@/lib/types";
import type { TripPatch } from "@/lib/validation";
import { ShareControl } from "./ShareControl";


export function TripHeader({ trip, onSave, onShareChange }: { trip: Trip; onSave: (patch: TripPatch) => Promise<void>; onShareChange?: (shareToken: string | null) => void }) {
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

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave({ name, plannedDate });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the trip");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <header>
        <div className="flex items-start justify-between gap-2">
          <h1 className="min-w-0 truncate text-lg font-semibold leading-9">{trip.name}</h1>
          <div className="flex shrink-0">
            <button type="button" onClick={beginEdit} className={btnGhost}>Edit trip</button>
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
        <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
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
