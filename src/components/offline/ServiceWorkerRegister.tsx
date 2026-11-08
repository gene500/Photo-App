"use client";

import { useEffect } from "react";

/** Registers the offline fallback worker: production builds, or dev/e2e with NEXT_PUBLIC_SW=1. Renders nothing. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_SW !== "1") return;
    // The property can exist but be undefined (some private modes and webviews), and register() can throw before it returns a promise.
    try {
      navigator.serviceWorker?.register(process.env.NODE_ENV === "production" ? "/sw.js" : "/sw.js?dev=1", { scope: "/" }).catch(() => {
        /* the app works the same without it */
      });
    } catch {
      /* the app works the same without it */
    }
  }, []);
  return null;
}
