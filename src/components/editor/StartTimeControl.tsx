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
export function StartTimeControl({ plannedDate, departAt, defaultDepartAt = null, lng, disabled, hour24 = false, onChange, onReset, draft: draftProp, onDraftChange, commitRef }: {
  plannedDate: string;
  departAt: string | null;
  /** Shown (and used by the schedule) while no start time is saved: the current time on the trip's day. */
  defaultDepartAt?: string | null;
  /** Longitude of the first stop, which decides which calendar day a picked time belongs to. */
  lng?: number;
  disabled?: boolean;
  /** The 24-hour clock setting: a native time input follows the browser's locale (it may show AM/PM), so two selects are shown instead. */
  hour24?: boolean;
  /** Resolves when saved. `null` clears the start time. */
  onChange: (iso: string | null) => void | Promise<void>;
  /** Clears the start time back to now; the button shows only while the start time differs from now. */
  onReset?: () => void;
  /** Optional: a parent that owns the unsaved edit keeps it when this control unmounts (a tab switch). */
  draft?: string | null;
  onDraftChange?: Dispatch<SetStateAction<string | null>>;
  /** Optional: holds the promise of the whole save chain while one runs (the first save and any newer picks saved after it), null when idle, so a caller can wait for the final time. */
  commitRef?: { current: Promise<void> | null };
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
  // The newest time picked from the 24-hour selects. A pick made while a save is in flight is saved right after it (the last
  // pick wins, rapid picks coalesce), so the selects never show a time that was not saved.
  const latest = useRef<string | null>(null);

  async function commit(chosen?: string) {
    const next = chosen ?? draft;
    if (next === null || saving.current) return; // Enter then blur must not save twice
    // An emptied or half-typed field is not a choice (use "Reset to now" to clear it): fall back to the saved time.
    const first = next === "" || next === saved ? null : fromTimeValue(plannedDate, next, lng);
    if (!first) return setDraft(null);
    saving.current = true;
    const work = (async () => {
      let done = next;
      try {
        let iso: string | null = first;
        while (iso) {
          await onChange(iso); // the field keeps showing the new time while it saves
          const newer = latest.current;
          if (newer === null || newer === done) break;
          done = newer;
          iso = fromTimeValue(plannedDate, newer, lng);
        }
      } finally {
        saving.current = false;
        latest.current = null;
        // Keep an edit made while this save was in flight; only clear the draft if it is still what was saved.
        setDraft((d) => (d === done ? null : d));
      }
    })();
    if (commitRef) commitRef.current = work;
    try {
      await work;
    } finally {
      if (commitRef && commitRef.current === work) commitRef.current = null;
    }
  }

  const shown = draft ?? saved;
  const [hh, mm] = /^\d{2}:\d{2}$/.test(shown) ? shown.split(":") : ["", ""];
  const pick = (h: string, m: string) => {
    const next = `${h || "00"}:${m || "00"}`;
    setDraft(next);
    latest.current = next;
    void commit(next); // each select is a whole choice, so it saves at once (there is no blur to wait for between the two)
  };
  const selectClass = `${inputClass} !mt-0 !w-auto min-w-0 !px-2 !py-1`;

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-muted">
      {/* In 24-hour mode the visible text names the group (a label would also point at the hour select, so "Start time" matched twice). */}
      {hour24 ? <span id={`${id}-label`} className="whitespace-nowrap">Start time</span> : <label htmlFor={id} className="whitespace-nowrap">Start time</label>}
      {hour24 ? (
        <span role="group" aria-labelledby={`${id}-label`} className="inline-flex items-center gap-1">
          <select aria-label="Start time hour" disabled={disabled} value={hh} aria-describedby={departAt ? undefined : `${id}-hint`} onChange={(e) => pick(e.target.value, mm)} className={selectClass}>
            {hh === "" && <option value="" />}
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={pad(h)}>{pad(h)}</option>)}
          </select>
          <span aria-hidden>:</span>
          <select aria-label="Start time minute" disabled={disabled} value={mm} onChange={(e) => pick(hh, e.target.value)} className={selectClass}>
            {mm === "" && <option value="" />}
            {Array.from({ length: 60 }, (_, m) => <option key={m} value={pad(m)}>{pad(m)}</option>)}
          </select>
        </span>
      ) : (
      <input
        id={id}
        type="time"
        value={draft ?? saved}
        disabled={disabled}
        aria-describedby={departAt ? undefined : `${id}-hint`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => { if (e.key === "Enter") void commit(); }}
        className={selectClass}
      />
      )}
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
