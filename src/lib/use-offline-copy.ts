"use client";

import { useEffect } from "react";
import { claimOwner, saveTripCopy } from "@/lib/offline-store";
import type { Stop, Trip } from "@/lib/types";

const SAVE_DELAY_MS = 1500;

/** Keeps the device's offline copy of the open trip current (debounced; skipped while offline so a stale view never overwrites it). */
export function useOfflineCopy(trip: Trip, stops: Stop[], userId: string | undefined, delayMs = SAVE_DELAY_MS) {
  useEffect(() => {
    if (!userId) return;
    const t = setTimeout(() => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      claimOwner(userId);
      saveTripCopy({ ...trip, stops });
    }, delayMs);
    return () => clearTimeout(t);
  }, [trip, stops, userId, delayMs]);
}
