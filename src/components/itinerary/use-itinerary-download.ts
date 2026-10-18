"use client";

import { useCallback, useRef, useState } from "react";
import { saveBlob } from "@/lib/itinerary-download";

type Make = () => Promise<{ blob: Blob; fileName: string }>;

export type DownloadState =
  | { status: "idle" }
  | { status: "preparing" }
  | { status: "ready"; blob: Blob; fileName: string }
  | { status: "error"; message: string };

/**
 * Two steps so the file is saved from a fresh tap: `prepare` does the slow work (weather, map image, fonts, jsPDF),
 * then `save` runs synchronously inside the click on the dialog's Download button. Safari treats a download started
 * after awaited work, with the tap's user activation long gone, as unrequested and asks about it.
 */
export function useItineraryDownload(): {
  state: DownloadState;
  /** No-op while preparing. */
  prepare: (make: Make) => void;
  /** Synchronous saveBlob from the ready state, then back to idle. */
  save: () => void;
  /** Back to idle; a result still being made is dropped. */
  cancel: () => void;
  /** Runs the last make again. */
  retry: () => void;
} {
  const [state, setState] = useState<DownloadState>({ status: "idle" });
  const stateRef = useRef(state);
  const seq = useRef(0);
  const lastMake = useRef<Make | null>(null);

  const set = useCallback((s: DownloadState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  const prepare = useCallback((make: Make) => {
    if (stateRef.current.status === "preparing") return;
    lastMake.current = make;
    const mine = ++seq.current;
    set({ status: "preparing" });
    make().then(
      ({ blob, fileName }) => {
        if (seq.current === mine) set({ status: "ready", blob, fileName });
      },
      (e) => {
        if (seq.current !== mine) return;
        console.error("PDF itinerary failed", e);
        set({ status: "error", message: "Could not create the PDF. Try again." });
      },
    );
  }, [set]);

  const save = useCallback(() => {
    const s = stateRef.current;
    if (s.status !== "ready") return;
    saveBlob(s.blob, s.fileName); // no await before this: it must run inside the click
    seq.current++;
    set({ status: "idle" });
  }, [set]);

  const cancel = useCallback(() => {
    seq.current++;
    set({ status: "idle" });
  }, [set]);

  const retry = useCallback(() => {
    if (lastMake.current) prepare(lastMake.current);
  }, [prepare]);

  return { state, prepare, save, cancel, retry };
}
