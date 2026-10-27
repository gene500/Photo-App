"use client";

import { useEffect } from "react";

export const IN_APP_KEY = "rtpp.inapp.v1";

/** Marks this browser tab as having loaded the signed-in app, so Settings' Back can step back to the page the user left (the referrer only reflects the first full page load, not in-app link clicks). */
export function InAppNavMarker() {
  useEffect(() => {
    try {
      window.sessionStorage.setItem(IN_APP_KEY, "1");
    } catch {
      // Storage blocked: Back falls back to the trips list.
    }
  }, []);
  return null;
}
