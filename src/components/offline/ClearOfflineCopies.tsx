"use client";

import { useEffect } from "react";
import { clearAllCopies } from "@/lib/offline-store";

/** Rendered only by pages the server produced for a signed-out visitor (login, signup): any offline copies left on this device belong to an ended session. */
export function ClearOfflineCopies() {
  useEffect(() => {
    clearAllCopies();
  }, []);
  return null;
}
