"use client";

import { useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { api } from "@/lib/api-client";
import { checkPhotoFile, PHOTO_TYPES } from "@/lib/photo-rules";
import type { Stop } from "@/lib/types";
import type { StopPatch } from "@/lib/validation";

type Props = {
  stop: Stop;
  onClose: () => void;
  onSave: (patch: StopPatch) => Promise<void>;
  onPhotoChange: (stop: Stop) => void;
};

const inputClass = "mt-1 w-full rounded border px-2 py-1";
const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export function StopDrawer({ stop, onClose, onSave, onPhotoChange }: Props) {
  const [name, setName] = useState(stop.name);
  const [notes, setNotes] = useState(stop.notes ?? "");
  const [visited, setVisited] = useState(stop.visited);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave({ name, notes: notes.trim() === "" ? null : notes, visited });
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
    <div role="dialog" aria-modal="true" aria-label={`Edit ${stop.name}`} className="fixed inset-y-0 right-0 z-20 w-full max-w-md space-y-3 overflow-y-auto border-l bg-white p-4 shadow-xl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Edit stop</h2>
        <button type="button" onClick={onClose} className="text-sm underline">Close</button>
      </div>
      <p className="text-xs text-gray-500">
        {stop.source === "suggested" ? "Suggested from OpenStreetMap" : "Manual pin"} · {stop.lat.toFixed(4)}, {stop.lng.toFixed(4)}
      </p>
      <label className="block">
        <span className="text-sm">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </label>
      <label className="block">
        <span className="text-sm">Notes</span>
        <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={visited} onChange={(e) => setVisited(e.target.checked)} />
        Visited
      </label>
      <div className="space-y-2">
        <p className="text-sm font-medium">Reference photo</p>
        {stop.photoUrl ? (
          <div className="space-y-1">
            {/* eslint-disable-next-line @next/next/no-img-element -- user uploads served by an auth-checked route */}
            <img src={stop.photoUrl} alt={`Reference for ${stop.name}`} className="max-h-48 rounded" />
            <button type="button" disabled={busy} onClick={() => void removePhoto()} className="text-sm text-red-700 underline">
              Remove photo
            </button>
          </div>
        ) : (
          <p className="text-xs text-gray-500">No photo yet.</p>
        )}
        <label className="block text-sm">
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
        <p className="text-xs text-gray-500">JPEG, PNG or WebP, up to 4 MB.</p>
      </div>
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
      <button type="button" disabled={busy} onClick={() => void save()} className="rounded bg-blue-600 px-4 py-2 text-white">
        Save
      </button>
    </div>
  );
}
