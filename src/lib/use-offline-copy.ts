"use client";

import { useEffect } from "react";
import { claimOwner, hasOwner, offlineSavingDisabled, onOfflineSavingDisabled, saveTripCopy } from "@/lib/offline-store";
import type { Stop, Trip } from "@/lib/types";

const SAVE_DELAY_MS = 1500;

/** Keeps the device's offline copy of the open trip current (debounced; skipped while offline so a stale view never overwrites it). */
export function useOfflineCopy(trip: Trip, stops: Stop[], userId: string | undefined, delayMs = SAVE_DELAY_MS) {
  useEffect(() => {
    if (!userId) return;
    if (offlineSavingDisabled()) return;
    const t = setTimeout(() => {
      if (offlineSavingDisabled()) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      if (!hasOwner()) return; // signed out elsewhere (owner mark cleared): never write a copy back
      claimOwner(userId);
      saveTripCopy({ ...trip, stops });
    }, delayMs);
    const stopListening = onOfflineSavingDisabled(() => clearTimeout(t)); // signing out cancels the pending save
    return () => {
      clearTimeout(t);
      stopListening();
    };
  }, [trip, stops, userId, delayMs]);
}
