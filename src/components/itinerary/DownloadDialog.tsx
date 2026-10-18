"use client";

import { useEffect, useRef } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { btnPrimary, btnSecondary } from "@/components/ui/styles";
import type { useItineraryDownload } from "./use-itinerary-download";

/** Themed dialog for the PDF download: preparing, then a Download button to tap (so the save has fresh user activation), or an error. */
export function DownloadDialog({ download }: { download: ReturnType<typeof useItineraryDownload> }) {
  const { state, save, cancel, retry } = download;
  const saveRef = useRef<HTMLButtonElement>(null);
  const ready = state.status === "ready";
  useEffect(() => {
    if (ready) saveRef.current?.focus(); // the Cancel button that had focus while preparing is gone
  }, [ready]);

  const description =
    state.status === "preparing" ? "Preparing your PDF…" : state.status === "ready" ? "Your PDF is ready." : state.status === "error" ? state.message : "";
  return (
    <Dialog open={state.status !== "idle"} title="Itinerary PDF" description={description} onCancel={cancel} busy={state.status === "preparing"}>
      {state.status === "error" ? (
        <>
          <button key="close" type="button" className={btnSecondary} onClick={cancel}>Close</button>
          <button key="retry" type="button" className={btnPrimary} onClick={retry}>Try again</button>
        </>
      ) : (
        <>
          <button key="cancel" type="button" className={btnSecondary} onClick={cancel}>Cancel</button>
          {ready && <button key="save" ref={saveRef} type="button" className={btnPrimary} onClick={save}>Download</button>}
        </>
      )}
    </Dialog>
  );
}
