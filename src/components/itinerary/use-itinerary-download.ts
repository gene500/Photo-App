"use client";

import { useCallback, useRef, useState } from "react";
import { saveBlob } from "@/lib/itinerary-download";

export function useItineraryDownload(): {
  busy: boolean;
  error: string | null;
  run: (make: () => Promise<{ blob: Blob; fileName: string }>) => Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const run = useCallback(async (make: () => Promise<{ blob: Blob; fileName: string }>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const { blob, fileName } = await make();
      saveBlob(blob, fileName);
    } catch (e) {
      console.error("PDF itinerary failed", e);
      setError("Could not create the PDF. Try again.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, error, run };
}
