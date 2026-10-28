"use client";

import { useId, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { btnGhost, inputClass } from "@/components/ui/styles";
import { solarDateAt } from "@/lib/best-time";
import { useMounted } from "@/lib/use-mounted";

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
 * On a daylight-saving change day a clock time that does not exist (the spring-forward gap) moves forward by the jump
 * (02:30 becomes 03:30) and an ambiguous one (fall back) is the first of the two, as the Date constructor defines.
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

/** Lets the traveller pick when the trip starts; with none saved it starts at the time the editor was opened. */
export function StartTimeControl({ plannedDate, departAt, defaultDepartAt = null, lng, disabled, onChange, onReset, draft: draftProp, onDraftChange }: {
  plannedDate: string;
  departAt: string | null;
  /** Shown (and used by the schedule) while no start time is saved: the current time on the trip's day. */
  defaultDepartAt?: string | null;
  /** Longitude of the first stop, which decides which calendar day a picked time belongs to. */
  lng?: number;
  disabled?: boolean;
  /** Resolves when saved. `null` clears the start time. */
  onChange: (iso: string | null) => void | Promise<void>;
  /** Clears the start time back to now; the button shows only while the start time differs from now. */
  onReset?: () => void;
  /** Optional: a parent that owns the unsaved edit keeps it when this control unmounts (a tab switch). */
  draft?: string | null;
  onDraftChange?: Dispatch<SetStateAction<string | null>>;
}) {
  const id = useId();
  // The time is read in the viewer's zone, so the server (and the first client render) show an empty field.
  const mounted = useMounted();
  const saved = mounted ? toTimeValue(departAt ?? defaultDepartAt) : "";
  // null while the person is not editing, so the field always follows the saved value.
  const [ownDraft, setOwnDraft] = useState<string | null>(null);
  const draft = draftProp !== undefined ? draftProp : ownDraft;
  const setDraft = onDraftChange ?? setOwnDraft;

  const saving = useRef(false);

  async function commit() {
    if (draft === null || saving.current) return; // Enter then blur must not save twice
    const next = draft;
    // An emptied or half-typed field is not a choice (use "Reset to now" to clear it): fall back to the saved time.
    const iso = next === "" || next === saved ? null : fromTimeValue(plannedDate, next, lng);
    if (!iso) return setDraft(null);
    saving.current = true;
    try {
      await onChange(iso); // the field keeps showing the new time while it saves
    } finally {
      saving.current = false;
      // Keep an edit made while this save was in flight; only clear the draft if it is still what was saved.
      setDraft((d) => (d === next ? null : d));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-muted">
      <label htmlFor={id} className="whitespace-nowrap">Start time</label>
      <input
        id={id}
        type="time"
        value={draft ?? saved}
        disabled={disabled}
        aria-describedby={departAt ? undefined : `${id}-hint`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => { if (e.key === "Enter") void commit(); }}
        className={`${inputClass} !mt-0 !w-auto min-w-0 !px-2 !py-1`}
      />
      {onReset && (departAt && saved !== toTimeValue(defaultDepartAt) ? (
        <button type="button" disabled={disabled} onClick={onReset} className={`${btnGhost} whitespace-nowrap !px-1`}>
          Reset to now
        </button>
      ) : (
        // Holds the button's room while it is hidden, so it appearing (right after a start time is saved) cannot move
        // Optimize down between a press and its release, which loses the click. The "Now" hint sits in that same room,
        // so the row stays one line where it fits instead of the hint wrapping below.
        <span className="relative inline-flex">
          <span aria-hidden data-testid="reset-placeholder" className={`${btnGhost} invisible whitespace-nowrap !px-1`}>Reset to now</span>
          {!departAt && <span id={`${id}-hint`} className="absolute inset-0 flex items-center px-2 text-xs">Now</span>}
        </span>
      ))}
      {!departAt && !onReset && <span id={`${id}-hint`} className="text-xs">Now</span>}
    </div>
  );
}
