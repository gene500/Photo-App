"use client";

import { useEffect, useMemo, useState } from "react";
import { hikeKey, type Hike } from "./hike";
import { subscribeHike } from "./hike-cache";

export type HikePoint = { id: string; lat: number; lng: number };

/**
 * Lazily loaded hikes for some places (keyed by `id`): nothing is requested for a place until it is in `points`, each
 * ~11 m cell is requested once, and requests that are still waiting are dropped when the place leaves `points` or the
 * component unmounts. A place with no hike, a failed lookup and being offline all give no entry: hikes are decorative.
 */
export function useHikes(points: readonly HikePoint[]): ReadonlyMap<string, Hike> {
  const sig = points.map((p) => `${p.id}@${hikeKey(p.lat, p.lng)}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `sig` stands for the contents of `points`
  const stable = useMemo(() => points.map((p) => ({ ...p })), [sig]);
  const [found, setFound] = useState<ReadonlyMap<string, { key: string; hike: Hike }>>(new Map());
  useEffect(() => {
    let live = true;
    const releases: (() => void)[] = [];
    for (const p of stable) {
      const key = hikeKey(p.lat, p.lng);
      const { promise, release } = subscribeHike(p.lat, p.lng);
      releases.push(release);
      void promise.then((hike) => {
        if (!live || !hike) return;
        setFound((prev) => (prev.get(p.id)?.key === key ? prev : new Map(prev).set(p.id, { key, hike })));
      });
    }
    return () => {
      live = false;
      for (const r of releases) r();
    };
  }, [stable]);
  return useMemo(() => {
    const out = new Map<string, Hike>();
    for (const p of stable) {
      const f = found.get(p.id);
      if (f && f.key === hikeKey(p.lat, p.lng)) out.set(p.id, f.hike);
    }
    return out;
  }, [stable, found]);
}

/** The hike for one place, or null (see useHikes). `enabled` false requests nothing. */
export function useHike(id: string, lat: number, lng: number, enabled = true): Hike | null {
  const points = useMemo(() => (enabled ? [{ id, lat, lng }] : []), [enabled, id, lat, lng]);
  return useHikes(points).get(id) ?? null;
}
