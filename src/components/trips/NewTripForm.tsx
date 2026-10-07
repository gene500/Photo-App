"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { btnPrimary, inputClass } from "@/components/ui/styles";
import { api } from "@/lib/api-client";
import { localDateOnly } from "@/lib/dates";


const noopSubscribe = () => () => {};

/** The viewer's local date; empty during server render so hydration never mismatches. */
function useLocalToday(): string {
  return useSyncExternalStore(noopSubscribe, () => localDateOnly(new Date()), () => "");
}

export function NewTripForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const today = useLocalToday();
  const [editedDate, setEditedDate] = useState<string | null>(null);
  const plannedDate = editedDate ?? today;
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const { trip } = await api.createTrip({ name, plannedDate });
      router.push(`/trips/${trip.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the trip");
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-4 rounded-2xl bg-surface p-5 shadow-sm ring-1 ring-border">
      <h2 className="text-lg font-semibold">New trip</h2>
      <label className="block">
        <span className="text-sm text-muted">Trip name</span>
        <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </label>
      <label className="block">
        <span className="text-sm text-muted">Planned date</span>
        <input type="date" required value={plannedDate} onChange={(e) => setEditedDate(e.target.value)} className={inputClass} />
      </label>
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      <button type="submit" disabled={pending} className={btnPrimary}>
        Create trip
      </button>
    </form>
  );
}
