"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { PlaceSearch } from "@/components/PlaceSearch";
import { api } from "@/lib/api-client";
import type { Place } from "@/lib/types";

const inputClass = "mt-1 w-full rounded border px-2 py-1";

export function NewTripForm({ today }: { today: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [plannedDate, setPlannedDate] = useState(today);
  const [start, setStart] = useState<Place | null>(null);
  const [end, setEnd] = useState<Place | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    if (!start || !end) {
      setError("Choose a start and an end location");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { trip } = await api.createTrip({ name, plannedDate, start, end });
      router.push(`/trips/${trip.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the trip");
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-3 rounded border p-4">
      <h2 className="text-lg font-semibold">New trip</h2>
      <label className="block">
        <span className="text-sm">Trip name</span>
        <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </label>
      <label className="block">
        <span className="text-sm">Planned date</span>
        <input type="date" required value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} className={inputClass} />
      </label>
      <PlaceSearch label="Start" value={start} onChange={setStart} testId="place-start" />
      <PlaceSearch label="End" value={end} onChange={setEnd} testId="place-end" />
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      <button type="submit" disabled={pending} className="rounded bg-blue-600 px-4 py-2 text-white">
        Create trip
      </button>
    </form>
  );
}
