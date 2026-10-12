"use client";

import { useId, useState } from "react";
import { inputClass } from "@/components/ui/styles";

const pad = (n: number) => String(n).padStart(2, "0");

/** "HH:MM" in the viewer's own time zone, the way the trip's other clock times are shown. */
export function toTimeValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The instant for `time` ("HH:MM") on the trip's calendar day ("YYYY-MM-DD") in the viewer's time zone; null when either is invalid. */
export function fromTimeValue(plannedDate: string, time: string): string | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(plannedDate);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!day || !clock) return null;
  const d = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]), Number(clock[1]), Number(clock[2]));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Lets the traveller pick when the trip starts; leaving it empty means "sunrise at the first stop". */
export function StartTimeControl({ plannedDate, departAt, onChange }: {
  plannedDate: string;
  departAt: string | null;
  /** Resolves when saved. `null` clears the start time. */
  onChange: (iso: string | null) => void | Promise<void>;
}) {
  const id = useId();
  const saved = toTimeValue(departAt);
  // null while the person is not editing, so the field always follows the saved value.
  const [draft, setDraft] = useState<string | null>(null);

  function commit() {
    if (draft === null) return;
    const next = draft;
    setDraft(null);
    if (next === saved) return;
    if (next === "") void onChange(null);
    else {
      const iso = fromTimeValue(plannedDate, next);
      if (iso) void onChange(iso);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
      <label htmlFor={id}>Start time</label>
      <input
        id={id}
        type="time"
        value={draft ?? saved}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
        className={`${inputClass} !mt-0 w-auto min-w-0`}
      />
      {!departAt && <span className="text-xs">Sunrise at the first stop</span>}
    </div>
  );
}
