"use client";

import { useEffect } from "react";

/** Registers the offline fallback worker: production builds, or dev/e2e with NEXT_PUBLIC_SW=1. Renders nothing. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_SW !== "1") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* the app works the same without it */
    });
  }, []);
  return null;
}
