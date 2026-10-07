"use client";

import { useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { btnGhost, btnPrimary, inputClass } from "@/components/ui/styles";
import { api } from "@/lib/api-client";
import { checkPhotoFile, PHOTO_TYPES } from "@/lib/photo-rules";
import type { LightPref, Stop } from "@/lib/types";
import { MAX_DWELL_MINUTES, type StopPatch } from "@/lib/validation";

type Props = {
  stop: Stop;
  onClose: () => void;
  onSave: (patch: StopPatch) => Promise<void>;
  onPhotoChange: (stop: Stop) => void;
};

const LIGHT_OPTIONS: [LightPref, string][] = [["any", "Any"], ["sunrise", "Sunrise"], ["golden", "Golden hour"], ["sunset", "Sunset"]];

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export function StopDrawer({ stop, onClose, onSave, onPhotoChange }: Props) {
  const [initial] = useState({ name: stop.name, notes: stop.notes ?? null, visited: stop.visited, lightPref: stop.lightPref, dwellMinutes: stop.dwellMinutes });
  const [name, setName] = useState(stop.name);
  const [notes, setNotes] = useState(stop.notes ?? "");
  const [visited, setVisited] = useState(stop.visited);
  const [lightPref, setLightPref] = useState<LightPref>(stop.lightPref);
  const [dwell, setDwell] = useState(String(stop.dwellMinutes));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      if (Object.keys(patch).length > 0) await onSave(patch);
      onClose();
    } catch (e) {
      setError(message(e, "Couldn't save the stop"));
    } finally {
      setBusy(false);
    }
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
    <div role="dialog" aria-modal="true" aria-label={`Edit ${stop.name}`} className="fixed inset-y-0 right-0 z-20 w-full max-w-md space-y-4 overflow-y-auto rounded-l-2xl bg-surface p-5 text-foreground shadow-2xl ring-1 ring-border">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Edit stop</h2>
        <button type="button" onClick={onClose} className={btnGhost}>Close</button>
      </div>
      <p className="text-xs text-muted">
        {stop.source === "suggested" ? "Suggested from OpenStreetMap" : "Manual pin"} · {stop.lat.toFixed(4)}, {stop.lng.toFixed(4)}
      </p>
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
