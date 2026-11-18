"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import type { Stop } from "@/lib/types";

/**
 * Finds the parking lot for every stop whose lookup never finished (`accessResolvedAt === null`): stops opened with
 * the trip and stops added later. At most `maxInFlight` calls at once, each stop tried once per position per mount (a failure is
 * not retried until the next open), and the answer for a stop that has left the list is dropped.
 */
const online = () => typeof navigator === "undefined" || navigator.onLine !== false;

export type AccessResolver = {
  /** True while a lookup is queued or in flight (and the browser is online, so the queue can move). */
  isBusy: () => boolean;
  /** Settles when no lookup is queued or in flight (at once if none is), or after `maxMs`, whichever comes first; true if it had to wait. Never rejects. */
  whenIdle: (maxMs: number) => Promise<boolean>;
};

export function useAccessResolver(stops: Stop[], onStop: (s: Stop) => void, opts: { maxInFlight?: number; /** True for a stop that must not be looked up now (a move is being saved: the server still has the old position). It is looked up on a later scan once this is false. */ isHeld?: (id: string) => boolean } = {}): AccessResolver {
  const max = opts.maxInFlight ?? 3;
  const tried = useRef(new Set<string>());
  const inFlight = useRef(0);
  const live = useRef(new Set<string>());
  const onStopRef = useRef(onStop);
  const heldRef = useRef(opts.isHeld);
  const queue = useRef<string[]>([]);
  const alive = useRef(true);
  const pump = useRef<() => void>(() => {});
  const flying = useRef(new Set<string>());
  const idleWaiters = useRef(new Set<() => void>());
  const stopsRef = useRef(stops);
  // Offline nothing is sent, so a queued lookup is not "pending": waiting for it would only run out the clock.
  // A held stop (its move is being saved) is pending too: its lot will be looked up once the new position is saved.
  const anyHeld = () => stopsRef.current.some((s) => heldRef.current?.(s.id));
  const busy = () => inFlight.current > 0 || (queue.current.length > 0 && online()) || anyHeld();
  const notifyIdle = () => {
    if (busy()) return;
    for (const w of [...idleWaiters.current]) w();
  };
  const [handle] = useState<AccessResolver>(() => ({
    isBusy: busy,
    whenIdle: (maxMs) =>
      !busy()
        ? Promise.resolve(false)
        : new Promise<boolean>((resolve) => {
            const done = () => {
              clearTimeout(timer);
              idleWaiters.current.delete(done);
              resolve(true);
            };
            const timer = setTimeout(done, maxMs);
            idleWaiters.current.add(done);
          }),
  }));
  const notifyRef = useRef(notifyIdle);
  useEffect(() => {
    notifyRef.current = notifyIdle;
  });

  useEffect(() => {
    onStopRef.current = onStop;
    heldRef.current = opts.isHeld;
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    pump.current = () => {
      while (alive.current && online() && inFlight.current < max && queue.current.length > 0) {
        const id = queue.current.shift()!;
        if (!live.current.has(id)) continue; // deleted while waiting
        if (heldRef.current?.(id)) continue; // a move started while it waited; the scan after the move queues it again
        inFlight.current++;
        flying.current.add(id);
        let call: Promise<{ stop: Stop }>;
        try {
          call = Promise.resolve(api.resolveAccess(id));
        } catch {
          call = Promise.reject(new Error("resolve failed"));
        }
        call
          .then(({ stop }) => {
            if (alive.current && live.current.has(stop.id)) onStopRef.current(stop);
          })
          .catch(() => {}) // never retried this mount; the next open tries again
          .finally(() => {
            inFlight.current--;
            flying.current.delete(id);
            pump.current();
            notifyRef.current();
          });
      }
    };
  }, [max]);

  const scan = useRef<() => void>(() => {});
  useEffect(() => {
    scan.current = () => {
      const list = stopsRef.current;
      live.current = new Set(list.map((s) => s.id));
      // Release keys of positions no stop is at now, so a failed stop at an unchanged position stays blocked
      // but one that returns to an earlier position (swap then Undo, dragged back) is looked up again.
      const current = new Set(list.map((s) => `${s.id}:${s.lat},${s.lng}`));
      for (const k of tried.current) if (!current.has(k)) tried.current.delete(k);
      if (online()) {
        for (const s of list) {
          // Keyed by position too: a moved stop (the server cleared its lot) is looked up again at the new spot.
          if (heldRef.current?.(s.id)) continue; // its new position is not saved yet: not marked tried, so it is looked up once it is
          const key = `${s.id}:${s.lat},${s.lng}`;
          if (s.accessResolvedAt === null && !tried.current.has(key)) {
            tried.current.add(key);
            if (!queue.current.includes(s.id)) queue.current.push(s.id);
          }
        }
      }
      pump.current();
      notifyRef.current(); // a hold that ended with nothing to look up leaves nobody else to wake the waiters
    };
  }, []);

  useEffect(() => {
    stopsRef.current = stops;
    scan.current();
  }, [stops]);

  // Offline: nothing is sent and nothing is marked tried; coming back online scans again.
  useEffect(() => {
    const onOnline = () => {
      // A lookup that failed because the network dropped kept its key; release the keys of stops still unresolved so they are tried again.
      for (const s of stopsRef.current) if (s.accessResolvedAt === null && !flying.current.has(s.id)) tried.current.delete(`${s.id}:${s.lat},${s.lng}`);
      scan.current();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);
  return handle;
}
