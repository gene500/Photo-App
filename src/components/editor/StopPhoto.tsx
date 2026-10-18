"use client";

import { useEffect, useRef, useState } from "react";
import { loadPlacePhoto } from "@/lib/place-photo-cache";
import type { Stop } from "@/lib/types";

type PhotoStop = Pick<Stop, "name" | "lat" | "lng" | "photoUrl">;

export function stopPhotoKey(stop: Pick<Stop, "lat" | "lng" | "name">): string {
  return `stop:${stop.lat.toFixed(5)},${stop.lng.toFixed(5)}:${stop.name}`;
}

const TILE = "h-10 w-10 shrink-0 rounded-xl";

/** The Stops-row thumbnail: the stop's own upload, else the place's photo (fetched once on screen), else a placeholder. */
export function StopPhoto({ stop }: { stop: PhotoStop }) {
  const key = stopPhotoKey(stop);
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === "undefined");
  // Keyed by place, so a swapped stop never shows the old place's photo.
  const [found, setFound] = useState<{ key: string; url: string | null } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const own = stop.photoUrl;
  const { name, lat, lng } = stop;

  useEffect(() => {
    if (visible || own) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setVisible(true);
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visible, own]);

  useEffect(() => {
    if (own || !visible) return;
    let current = true;
    void loadPlacePhoto({ key, name, lat, lng }).then((p) => {
      if (current) setFound({ key, url: p?.url ?? null });
    });
    return () => { current = false; };
  }, [own, visible, key, name, lat, lng]);

  const url = own ?? (found?.key === key ? found.url : null);
  if (url && failed !== url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- user uploads and allow-listed remote thumbnails
      <img src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(url)} className={`${TILE} bg-hover object-cover`} />
    );
  }
  return (
    <span ref={ref} data-testid="stop-photo-placeholder" className={`${TILE} flex items-center justify-center bg-accent-soft`}>
      <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4 text-accent-strong" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 5.5h2.2l.9-1.5h5.8l.9 1.5H14v7H2z" />
        <circle cx="8" cy="8.8" r="2.2" />
      </svg>
    </span>
  );
}
