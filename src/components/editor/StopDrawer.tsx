"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { btnGhost, btnPrimary, inputClass, btnIcon } from "@/components/ui/styles";
import { api } from "@/lib/api-client";
import { checkPhotoFile, PHOTO_TYPES } from "@/lib/photo-rules";
import type { LightPref, ShotItem, Stop, Suggestion } from "@/lib/types";
import { AlternativesPanel } from "./AlternativesPanel";
import type { SuggestionsStatus } from "./SuggestionsPanel";
import { MAX_DWELL_MINUTES, MAX_SHOT_ITEMS, MAX_SHOT_NOTES, MAX_SHOT_TEXT, type StopPatch } from "@/lib/validation";

type Props = {
  stop: Stop;
  onClose: () => void;
  onSave: (patch: StopPatch) => Promise<void>;
  onPhotoChange: (stop: Stop) => void;
  /** Nearby alternatives for this stop; the panel is shown only when the editor provides it. */
  alternatives?: { status: SuggestionsStatus; items: Suggestion[]; error: string | null; onFind: () => void; onSwap: (s: Suggestion) => void | Promise<void>; onDismissError: () => void };
};

const LIGHT_OPTIONS: [LightPref, string][] = [["any", "Any"], ["sunrise", "Sunrise"], ["golden", "Golden hour"], ["sunset", "Sunset"]];

// Checklist rows carry a local id (never sent to the server) so React keys survive deleting or reordering rows.
type ShotRow = ShotItem & { id: number };
const plain = (rows: ShotRow[]): ShotItem[] => rows.map(({ text, done }) => ({ text, done }));

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export function StopDrawer({ stop, onClose, onSave, onPhotoChange, alternatives }: Props) {
  const [initial] = useState({ name: stop.name, notes: stop.notes ?? null, visited: stop.visited, lightPref: stop.lightPref, dwellMinutes: stop.dwellMinutes, shotNotes: stop.shotNotes, shotChecklist: JSON.stringify(stop.shotChecklist) });
  const [name, setName] = useState(stop.name);
  const [notes, setNotes] = useState(stop.notes ?? "");
  const [visited, setVisited] = useState(stop.visited);
  const [lightPref, setLightPref] = useState<LightPref>(stop.lightPref);
  const [dwell, setDwell] = useState(String(stop.dwellMinutes));
  const [shotNotes, setShotNotes] = useState(stop.shotNotes ?? "");
  const nextId = useRef(stop.shotChecklist.length);
  const [shots, setShots] = useState<ShotRow[]>(() => stop.shotChecklist.map((s, i) => ({ ...s, id: i })));
  const [newShot, setNewShot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Modal behaviour: focus moves into the drawer when it opens and goes back to whatever opened it when it closes.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => {
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
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
    name !== initial.name || (notes.trim() === "" ? null : notes) !== initial.notes || visited !== initial.visited || lightPref !== initial.lightPref ||
    dwell !== String(stop.dwellMinutes) || (shotNotes.trim() === "" ? null : shotNotes) !== initial.shotNotes ||
    JSON.stringify(plain(shots)) !== initial.shotChecklist || newShot.trim() !== "";

  async function save() {
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
      const nextNotes = notes.trim() === "" ? null : notes;
      if (nextNotes !== initial.notes) patch.notes = nextNotes;
      if (visited !== initial.visited) patch.visited = visited;
      if (lightPref !== initial.lightPref) patch.lightPref = lightPref;
      if (dwellMinutes !== initial.dwellMinutes) patch.dwellMinutes = dwellMinutes;
      const nextShotNotes = shotNotes.trim() === "" ? null : shotNotes;
      if (nextShotNotes !== initial.shotNotes) patch.shotNotes = nextShotNotes;
      // A shot typed but not yet confirmed with Enter is kept rather than silently dropped.
      const pending = newShot.trim();
      const nextShots = plain(pending !== "" && shots.length < MAX_SHOT_ITEMS ? [...shots, { id: -1, text: pending.slice(0, MAX_SHOT_TEXT), done: false }] : shots);
      if (JSON.stringify(nextShots) !== initial.shotChecklist) patch.shotChecklist = nextShots;
      if (Object.keys(patch).length > 0) await onSave(patch);
      onClose();
    } catch (e) {
      setError(message(e, "Couldn't save the stop"));
    } finally {
      setBusy(false);
    }
  }

  function addShot() {
    const text = newShot.trim();
    if (text === "" || shots.length >= MAX_SHOT_ITEMS) return;
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
        <button type="button" onClick={onClose} className={btnGhost}>Close</button>
      </div>
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
        <input type="checkbox" className="h-4 w-4 accent-accent-strong" checked={visited} onChange={(e) => setVisited(e.target.checked)} />
        Visited
      </label>
      <div className="space-y-2">
        <p className="text-sm font-medium">Reference photo</p>
        {stop.photoUrl ? (
          <div className="space-y-1">
            {/* eslint-disable-next-line @next/next/no-img-element -- user uploads served by an auth-checked route */}
            <img src={stop.photoUrl} alt={`Reference for ${stop.name}`} className="max-h-48 rounded-xl" />
            <button type="button" disabled={busy} onClick={() => void removePhoto()} className="text-sm text-danger underline">
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
            className="mt-1 block"
          />
        </label>
        <p className="text-xs text-muted">JPEG, PNG or WebP, up to 4 MB.</p>
      </div>
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      <button type="button" disabled={busy} onClick={() => void save()} className={btnPrimary}>
        Save
      </button>
    </div>
  );
}
