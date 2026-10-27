"use client";

import { useEffect } from "react";
import { claimOwner, offlineSavingDisabled, onOfflineSavingDisabled, saveTripCopy } from "@/lib/offline-store";
import type { Stop, Trip } from "@/lib/types";

const SAVE_DELAY_MS = 1500;

/** Keeps the device's offline copy of the open trip current (debounced; skipped while offline so a stale view never overwrites it). */
export function useOfflineCopy(trip: Trip, stops: Stop[], userId: string | undefined, delayMs = SAVE_DELAY_MS) {
  useEffect(() => {
    if (!userId) return;
    if (offlineSavingDisabled()) return;
    let t: ReturnType<typeof setTimeout>;
    const run = () => {
      if (offlineSavingDisabled()) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      // The owner mark is gone when copies were cleared (Settings in another tab): claim it again. A sign-out
      // elsewhere switches saving off instead (checked above), so it never gets here.
      claimOwner(userId);
      saveTripCopy({ ...trip, stops });
    };
    t = setTimeout(run, delayMs);
    // A save skipped while offline is retried when the connection returns (a quick disconnect must not leave the copy stale).
    const onOnline = () => {
      clearTimeout(t);
      t = setTimeout(run, delayMs);
    };
    window.addEventListener("online", onOnline);
    const stopListening = onOfflineSavingDisabled(() => clearTimeout(t)); // signing out cancels the pending save
    return () => {
      clearTimeout(t);
      window.removeEventListener("online", onOnline);
      stopListening();
    };
  }, [trip, stops, userId, delayMs]);
}
