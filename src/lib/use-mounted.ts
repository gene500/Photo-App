import { useSyncExternalStore } from "react";

const noop = () => {};
const subscribe = () => noop;

/**
 * False on the server and during hydration, true on every client render after. Anything that depends on the viewer's
 * time zone (clock times, time inputs) renders a neutral placeholder until this is true, so the server's HTML (UTC on
 * Vercel) never disagrees with the browser's first render.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
