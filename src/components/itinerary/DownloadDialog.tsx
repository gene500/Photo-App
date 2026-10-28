"use client";

import { useEffect, useRef } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { btnPrimary, btnSecondary } from "@/components/ui/styles";
import type { useItineraryDownload } from "./use-itinerary-download";

/** Themed dialog for the PDF download: preparing, then a Download button to tap (so the save has fresh user activation), or an error. */
export function DownloadDialog({ download }: { download: ReturnType<typeof useItineraryDownload> }) {
  const { state, save, cancel, retry } = download;
  const saveRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const ready = state.status === "ready";
  const status = state.status;
  useEffect(() => {
    // The button that had focus is replaced on each change, so focus its successor instead of letting it fall to the page.
    const next = status === "ready" ? saveRef : status === "error" ? retryRef : status === "preparing" ? cancelRef : null;
    next?.current?.focus();
  }, [status]);

  const description =
    state.status === "preparing" ? "Preparing your PDF…" : state.status === "ready" ? "Your PDF is ready." : state.status === "error" ? <span role="alert">{state.message}</span> : "";
  return (
    <Dialog open={state.status !== "idle"} title="Itinerary PDF" description={description} onCancel={cancel} busy={state.status === "preparing"} backdropGraceMs={350}>
      {state.status === "error" ? (
        <>
          <button key="close" type="button" className={btnSecondary} onClick={cancel}>Close</button>
          <button key="retry" ref={retryRef} type="button" className={btnPrimary} onClick={retry}>Try again</button>
        </>
      ) : (
        <>
          <button key="cancel" ref={cancelRef} type="button" className={btnSecondary} onClick={cancel}>Cancel</button>
          {ready && <button key="save" ref={saveRef} type="button" className={btnPrimary} onClick={save}>Download</button>}
        </>
      )}
    </Dialog>
  );
}
