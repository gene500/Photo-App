"use client";

import { useEffect, useRef, useState } from "react";
import { claimOwner, offlineSavingDisabled, onOfflineSavingDisabled, onOfflineSavingEnabled, removeTripCopy, saveTripCopy } from "@/lib/offline-store";
import type { Stop, Trip } from "@/lib/types";

const SAVE_DELAY_MS = 1500;

/** What the server says about the state being saved: "fresh" = identical, "stale" = it differs (another tab or device changed it), "gone" = the trip no longer exists, "unknown" = could not be checked. */
export type Freshness = "fresh" | "stale" | "gone" | "unknown";

/**
 * Keeps the device's offline copy of the open trip current (debounced; skipped while offline so a stale view never overwrites it).
 * With `verify`, the state is checked against the server first and only a state known to be current is stored: a tab showing
 * old data (another tab deleted a stop) never writes it over the copy, and a trip deleted elsewhere gets no copy at all.
 */
export function useOfflineCopy(trip: Trip, stops: Stop[], userId: string | undefined, delayMs = SAVE_DELAY_MS, verify?: () => Promise<Freshness>) {
  const verifyRef = useRef(verify);
  useEffect(() => {
    verifyRef.current = verify;
  });
  // Saving switched back on (the same user signed in again in another tab) schedules the save that was cancelled.
  const [resumed, setResumed] = useState(0);
  useEffect(() => onOfflineSavingEnabled(() => setResumed((n) => n + 1)), []);
  useEffect(() => {
    if (!userId) return;
    if (offlineSavingDisabled()) return;
    let cancelled = false;
    let t: ReturnType<typeof setTimeout>;
    const canSave = () => !cancelled && !offlineSavingDisabled() && !(typeof navigator !== "undefined" && navigator.onLine === false);
    const run = async () => {
      if (!canSave()) return;
      if (verifyRef.current) {
        let state: Freshness;
        try {
          state = await verifyRef.current();
        } catch {
          state = "unknown";
        }
        if (state === "gone" && !cancelled && !offlineSavingDisabled()) removeTripCopy(trip.id);
        if (state !== "fresh" || !canSave()) return;
      }
      // The owner mark is gone when copies were cleared (Settings in another tab): claim it again. A sign-out
      // elsewhere switches saving off instead (checked above), so it never gets here.
      claimOwner(userId);
      saveTripCopy({ ...trip, stops });
    };
    t = setTimeout(() => void run(), delayMs);
    // A save skipped while offline is retried when the connection returns (a quick disconnect must not leave the copy stale).
    const onOnline = () => {
      clearTimeout(t);
      t = setTimeout(() => void run(), delayMs);
    };
    window.addEventListener("online", onOnline);
    const stopListening = onOfflineSavingDisabled(() => clearTimeout(t)); // signing out cancels the pending save
    return () => {
      cancelled = true;
      clearTimeout(t);
      window.removeEventListener("online", onOnline);
      stopListening();
    };
  }, [trip, stops, userId, delayMs, resumed]);
}
