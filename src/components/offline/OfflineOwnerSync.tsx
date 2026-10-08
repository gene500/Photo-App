"use client";

import { useEffect } from "react";
import { claimOwner } from "@/lib/offline-store";

/** Mounted where the signed-in user is known: wipes offline copies left on this device by a different user. */
export function OfflineOwnerSync({ userId }: { userId: string }) {
  useEffect(() => {
    claimOwner(userId);
  }, [userId]);
  return null;
}
