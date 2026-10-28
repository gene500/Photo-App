"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { btnGhost, btnPrimary, inputClass, btnIcon } from "@/components/ui/styles";
import { api } from "@/lib/api-client";
import { focusLost, softDisabled } from "@/lib/focus";
import { useWeatherLine } from "@/lib/use-weather";
import { checkPhotoFile, PHOTO_TYPES } from "@/lib/photo-rules";
import { hasContent } from "@/lib/text";
import type { LightPref, ShotItem, Stop, Suggestion } from "@/lib/types";
import { AlternativesPanel } from "./AlternativesPanel";
import { SkyCard } from "./SkyCard";
import { FOCUSABLE } from "@/components/ui/Dialog";
import type { SuggestionsStatus } from "./SuggestionsPanel";
import { MAX_DWELL_MINUTES, MAX_SHOT_ITEMS, MAX_SHOT_NOTES, MAX_SHOT_TEXT, type StopPatch } from "@/lib/validation";

type Props = {
  stop: Stop;
  /** The trip date (YYYY-MM-DD); the sky card shows sun and moon for this day at the stop. */
  plannedDate: string;
  /** When the trip reaches this stop; lets the drawer warn if the chosen light is forecast to be poor. */
  arrival?: Date | null;
  onClose: () => void;
  onSave: (patch: StopPatch) => Promise<void>;
  /** A save that failed after the drawer was already closed: the editor shows the message, since the drawer cannot. */
  onSaveError?: (message: string) => void;
  onPhotoChange: (stop: Stop) => void;
  /** Nearby alternatives for this stop; the panel is shown only when the editor provides it. */
  alternatives?: { status: SuggestionsStatus; items: Suggestion[]; error: string | null; onFind: () => void; onSwap: (s: Suggestion) => void | Promise<void>; onDismissError: () => void };
};

const LIGHT_OPTIONS: [LightPref, string][] = [["any", "Any"], ["sunrise", "Sunrise"], ["golden", "Golden hour"], ["sunset", "Sunset"]];

// Checklist rows carry a local id (never sent to the server) so React keys survive deleting or reordering rows.
type ShotRow = ShotItem & { id: number };
const plain = (rows: ShotRow[]): ShotItem[] => rows.map(({ text, done }) => ({ text, done }));


const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export function StopDrawer({ stop, plannedDate, onClose, onSave, onSaveError, onPhotoChange, alternatives, arrival }: Props) {
  const [initial] = useState({ name: stop.name, notes: stop.notes ?? null, visited: stop.visited, lightPref: stop.lightPref, dwellMinutes: stop.dwellMinutes, shotNotes: stop.shotNotes, shotChecklist: JSON.stringify(stop.shotChecklist) });
  const [name, setName] = useState(stop.name);
  const [notes, setNotes] = useState(stop.notes ?? "");
  // null until the box is touched here: until then it follows the stop (ticked on the card meanwhile), and only a touched box is saved.
  const [visitedEdit, setVisitedEdit] = useState<boolean | null>(null);
  const visited = visitedEdit ?? stop.visited;
  const visitedChanged = visitedEdit !== null && visitedEdit !== stop.visited;
  const [lightPref, setLightPref] = useState<LightPref>(stop.lightPref);
  const weather = useWeatherLine(stop.lat, stop.lng, arrival ?? null, lightPref);
  const [dwell, setDwell] = useState(String(stop.dwellMinutes));
  const [shotNotes, setShotNotes] = useState(stop.shotNotes ?? "");
  const nextId = useRef(stop.shotChecklist.length);
  const [shots, setShots] = useState<ShotRow[]>(() => stop.shotChecklist.map((s, i) => ({ ...s, id: i })));
  const [newShot, setNewShot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  // False once this drawer is gone: a save that finishes later must not close a drawer the user has reopened.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Modal behaviour: focus moves into the drawer when it opens and goes back to whatever opened it when it closes.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => {
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  // A save, upload or removal disables its controls while it runs; if that took keyboard focus with it, put it back on the
  // dialog when the work settles, so Escape and the Tab trap work again.
  useEffect(() => {
    if (busy) return;
    const el = document.activeElement;
    if (focusLost() || !dialogRef.current?.contains(el)) dialogRef.current?.focus();
  }, [busy]);

  function keepEditing() {
    setConfirmDiscard(false);
    dialogRef.current?.focus(); // the buttons are about to unmount; keep keyboard focus (and Escape) inside the drawer
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      // Unsaved edits are never dropped by a stray keypress: ask in the page first (a second Escape goes back to editing).
      if (dirty && !busy) {
        if (confirmDiscard) keepEditing();
        else setConfirmDiscard(true);
      } else if (!busy) onClose(); // a save in flight cannot be abandoned by a stray key
      return;
    }
    if (e.key !== "Tab") return;
    // Keep Tab inside the drawer (aria-modal): wrap at either end.
    const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialogRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // Swapping replaces the stop and closes the drawer, which would silently throw typed edits away; so it waits for Save.
  const dirty =
    name !== initial.name || (notes.trim() === "" ? null : notes) !== initial.notes || visitedChanged || lightPref !== initial.lightPref ||
    dwell !== String(stop.dwellMinutes) || (shotNotes.trim() === "" ? null : shotNotes) !== initial.shotNotes ||
    JSON.stringify(plain(shots)) !== initial.shotChecklist || hasContent(newShot);

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Send only what was edited here; fields left alone may have changed elsewhere
      // (e.g. Visited ticked in the list) and must not be overwritten with stale copies.
      const dwellMinutes = Number(dwell);
      if (dwell.trim() === "" || !Number.isInteger(dwellMinutes) || dwellMinutes < 0 || dwellMinutes > MAX_DWELL_MINUTES) {
        setError(`Time here must be a whole number of minutes from 0 to ${MAX_DWELL_MINUTES}`);
        return;
      }
      const patch: StopPatch = {};
      if (name !== initial.name) patch.name = name;
      const nextNotes = !hasContent(notes) ? null : notes;
      if (nextNotes !== initial.notes) patch.notes = nextNotes;
      if (visitedChanged) patch.visited = visited;
      if (lightPref !== initial.lightPref) patch.lightPref = lightPref;
      if (dwellMinutes !== initial.dwellMinutes) patch.dwellMinutes = dwellMinutes;
      const nextShotNotes = !hasContent(shotNotes) ? null : shotNotes;
      if (nextShotNotes !== initial.shotNotes) patch.shotNotes = nextShotNotes;
      // A shot typed but not yet confirmed with Enter is kept rather than silently dropped.
      const pending = hasContent(newShot) ? newShot.trim() : "";
      const nextShots = plain(pending !== "" && shots.length < MAX_SHOT_ITEMS ? [...shots, { id: -1, text: pending.slice(0, MAX_SHOT_TEXT), done: false }] : shots);
      if (JSON.stringify(nextShots) !== initial.shotChecklist) patch.shotChecklist = nextShots;
      if (Object.keys(patch).length > 0) await onSave(patch);
      if (mountedRef.current) onClose();
    } catch (e) {
      if (mountedRef.current) setError(message(e, "Couldn't save the stop"));
      else onSaveError?.(message(e, "Couldn't save the stop"));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  /** The Close button follows the same rule as Escape: unsaved edits are asked about first. */
  function requestClose() {
    if (busy) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }

  function addShot() {
    const text = newShot.trim();
    if (!hasContent(newShot) || shots.length >= MAX_SHOT_ITEMS) return;
    setShots([...shots, { id: nextId.current++, text, done: false }]);
    setNewShot("");
  }

  async function upload(file: File) {
    const problem = checkPhotoFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onPhotoChange((await api.uploadPhoto(stop.id, file)).stop);
    } catch (e) {
      setError(message(e, "Couldn't upload the photo"));
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto() {
    setBusy(true);
    setError(null);
    try {
      onPhotoChange((await api.removePhoto(stop.id)).stop);
    } catch (e) {
      setError(message(e, "Couldn't remove the photo"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={dialogRef} tabIndex={-1} onKeyDown={onKeyDown} role="dialog" aria-modal="true" aria-label={`Edit ${stop.name}`} className="anim-slide-in outline-none fixed inset-y-0 right-0 z-20 w-full max-w-md space-y-4 overflow-y-auto rounded-l-2xl bg-surface p-5 text-foreground shadow-2xl ring-1 ring-border">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Edit stop</h2>
        <button type="button" onClick={requestClose} className={btnGhost}>Close</button>
      </div>
      {confirmDiscard && dirty && (
        <div role="alert" className="space-y-2 rounded-lg border border-border bg-hover p-3 text-sm">
          <p>You have unsaved edits. Discard them and close?</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={btnGhost}>Discard edits</button>
            <button type="button" autoFocus onClick={keepEditing} className={btnPrimary}>Keep editing</button>
          </div>
        </div>
      )}
      <p className="text-xs text-muted">
        {stop.source === "suggested" ? "Suggested from OpenStreetMap" : "Manual pin"} · {stop.lat.toFixed(4)}, {stop.lng.toFixed(4)}
      </p>
      {alternatives && (
        <AlternativesPanel status={alternatives.status} alternatives={alternatives.items} error={alternatives.error} onFind={alternatives.onFind} onSwap={alternatives.onSwap} onDismissError={alternatives.onDismissError} swapBlockedReason={dirty ? "Save or close your edits before swapping this stop." : undefined} />
      )}
      <label className="block">
        <span className="text-sm text-muted">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </label>
      <label className="block">
        <span className="text-sm text-muted">Notes</span>
        <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-sm text-muted">Best light</span>
          <select value={lightPref} onChange={(e) => setLightPref(e.target.value as LightPref)} className={inputClass}>
            {LIGHT_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm text-muted">Time here (min)</span>
          <input type="number" inputMode="numeric" min={0} max={MAX_DWELL_MINUTES} step={5} value={dwell} onChange={(e) => setDwell(e.target.value)} className={inputClass} />
        </label>
      </div>
      {weather?.warning && <p data-testid="light-warning" className="text-xs text-sand">{weather.warning}</p>}
      <SkyCard lat={stop.lat} lng={stop.lng} plannedDate={plannedDate} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Shot list</legend>
        <label className="block">
          <span className="text-sm text-muted">Shot notes</span>
          <textarea rows={3} maxLength={MAX_SHOT_NOTES} value={shotNotes} onChange={(e) => setShotNotes(e.target.value)} className={inputClass} />
        </label>
        {shots.length > 0 && (
          <ul className="space-y-1">
            {shots.map((shot, i) => (
              <li key={shot.id} className="flex items-center gap-2">
                <label className="flex min-h-9 min-w-0 flex-1 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-accent-strong"
                    checked={shot.done}
                    onChange={(e) => setShots(shots.map((s, j) => (j === i ? { ...s, done: e.target.checked } : s)))}
                  />
                  <span className={`min-w-0 break-words ${shot.done ? "text-muted line-through" : ""}`}>{shot.text}</span>
                </label>
                <button type="button" onClick={() => setShots(shots.filter((_, j) => j !== i))} aria-label={`Delete shot ${shot.text}`} className={btnIcon}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          aria-label="Add a shot"
          placeholder={shots.length >= MAX_SHOT_ITEMS ? `Up to ${MAX_SHOT_ITEMS} shots` : "Add a shot, press Enter"}
          maxLength={MAX_SHOT_TEXT}
          disabled={shots.length >= MAX_SHOT_ITEMS}
          value={newShot}
          onChange={(e) => setNewShot(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addShot();
            }
          }}
          className={inputClass}
        />
      </fieldset>
      <label className="flex min-h-9 items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4 accent-accent-strong" checked={visited} onChange={(e) => setVisitedEdit(e.target.checked)} />
        Visited
      </label>
      <div className="space-y-2">
        <p className="text-sm font-medium">Reference photo</p>
        {stop.photoUrl ? (
          <div className="space-y-1">
            {/* eslint-disable-next-line @next/next/no-img-element -- user uploads served by an auth-checked route */}
            <img src={stop.photoUrl} alt={`Reference for ${stop.name}`} className="max-h-48 rounded-xl" />
            <button type="button" {...softDisabled(busy)} onClick={busy ? undefined : () => void removePhoto()} className="text-sm text-danger underline aria-disabled:opacity-50">
              Remove photo
            </button>
          </div>
        ) : (
          <p className="text-xs text-muted">No photo yet.</p>
        )}
        <label className="block text-sm text-muted">
          Upload photo
          <input
            type="file"
            accept={PHOTO_TYPES.join(",")}
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = "";
            }}
            className="mt-1 block w-full max-w-full"
          />
        </label>
        <p className="text-xs text-muted">JPEG, PNG or WebP, up to 4 MB.</p>
      </div>
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      <button type="button" {...softDisabled(busy)} onClick={busy ? undefined : () => void save()} className={btnPrimary}>
        Save
      </button>
    </div>
  );
}
