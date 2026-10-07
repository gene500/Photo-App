"use client";

import { useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { PlaceSearch } from "@/components/PlaceSearch";
import type { Place, Trip } from "@/lib/types";
import type { TripPatch } from "@/lib/validation";

const inputClass = "mt-1 w-full rounded border px-2 py-1";

export function TripHeader({ trip, onSave }: { trip: Trip; onSave: (patch: TripPatch) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(trip.name);
  const [plannedDate, setPlannedDate] = useState(trip.plannedDate);
  const [start, setStart] = useState<Place>(trip.start);
  const [end, setEnd] = useState<Place>(trip.end);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function beginEdit() {
    setName(trip.name);
    setPlannedDate(trip.plannedDate);
    setStart(trip.start);
    setEnd(trip.end);
    setError(null);
    setEditing(true);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave({ name, plannedDate, start, end });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the trip");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <header className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-xl font-semibold">{trip.name}</h1>
          <button type="button" onClick={beginEdit} className="text-sm underline">Edit trip</button>
        </div>
        <p className="text-sm text-gray-700">{trip.start.name} → {trip.end.name}</p>
        <p className="text-sm text-gray-700">Planned for {trip.plannedDate}</p>
      </header>
    );
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-2 rounded border p-3">
      <label className="block">
        <span className="text-sm">Trip name</span>
        <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </label>
      <label className="block">
        <span className="text-sm">Planned date</span>
        <input type="date" required value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} className={inputClass} />
      </label>
      <PlaceSearch label="Start" value={start} onChange={setStart} />
      <PlaceSearch label="End" value={end} onChange={setEnd} />
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded bg-blue-600 px-3 py-1 text-white">Save trip</button>
        <button type="button" onClick={() => setEditing(false)} className="rounded border px-3 py-1">Cancel</button>
      </div>
    </form>
  );
}
