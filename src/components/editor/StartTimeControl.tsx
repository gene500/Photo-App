"use client";

import { useId, useRef, useState } from "react";
import { btnGhost, inputClass } from "@/components/ui/styles";
import { solarDateAt } from "@/lib/best-time";

const pad = (n: number) => String(n).padStart(2, "0");

/** "HH:MM" in the viewer's own time zone, the way the trip's other clock times are shown. */
export function toTimeValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The instant for `time` ("HH:MM", read in the viewer's time zone) that falls on the trip's day ("YYYY-MM-DD") where the
 * trip is: with `lng` the day is the solar day at that longitude (as for best times), so a viewer in another time zone
 * cannot move the trip to the neighbouring day. Without `lng` it is the viewer's own calendar day. Null when invalid.
 */
export function fromTimeValue(plannedDate: string, time: string, lng?: number): string | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(plannedDate);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!day || !clock) return null;
  const at = (offset: number) => new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]) + offset, Number(clock[1]), Number(clock[2]));
  const candidates = [0, -1, 1].map(at).filter((d) => !Number.isNaN(d.getTime()));
  if (candidates.length === 0) return null;
  const pick = lng === undefined ? candidates[0] : (candidates.find((d) => solarDateAt(d, lng) === plannedDate) ?? candidates[0]);
  return pick.toISOString();
}

/** Lets the traveller pick when the trip starts; leaving it empty means "sunrise at the first stop". */
export function StartTimeControl({ plannedDate, departAt, lng, disabled, onChange, onReset }: {
  plannedDate: string;
  departAt: string | null;
  /** Longitude of the first stop, which decides which calendar day a picked time belongs to. */
  lng?: number;
  disabled?: boolean;
  /** Resolves when saved. `null` clears the start time. */
  onChange: (iso: string | null) => void | Promise<void>;
  /** Clears the start time back to sunrise; the button shows only while a start time is set. */
  onReset?: () => void;
}) {
  const id = useId();
  const saved = toTimeValue(departAt);
  // null while the person is not editing, so the field always follows the saved value.
  const [draft, setDraft] = useState<string | null>(null);

  const saving = useRef(false);

  async function commit() {
    if (draft === null || saving.current) return; // Enter then blur must not save twice
    const next = draft;
    // An emptied or half-typed field is not a choice (use "Reset to sunrise" to clear it): fall back to the saved time.
    const iso = next === "" || next === saved ? null : fromTimeValue(plannedDate, next, lng);
    if (!iso) return setDraft(null);
    saving.current = true;
    try {
      await onChange(iso); // the field keeps showing the new time while it saves
    } finally {
      saving.current = false;
      setDraft(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
      <label htmlFor={id}>Start time</label>
      <input
        id={id}
        type="time"
        value={draft ?? saved}
        disabled={disabled}
        aria-describedby={departAt ? undefined : `${id}-hint`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => { if (e.key === "Enter") void commit(); }}
        className={`${inputClass} !mt-0 w-auto min-w-0`}
      />
      {departAt && onReset && (
        <button type="button" disabled={disabled} onClick={onReset} className={btnGhost}>
          Reset to sunrise
        </button>
      )}
      {!departAt && <span id={`${id}-hint`} className="text-xs">Sunrise at the first stop</span>}
    </div>
  );
}
