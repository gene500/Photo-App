"use client";

import { useEffect, useState } from "react";
import { ErrorBanner } from "@/components/ErrorBanner";
import { useSettings } from "@/components/settings/SettingsProvider";
import { btnAccent, btnSecondary } from "@/components/ui/styles";
import { formatPhotoCount, formatRadiusKm } from "@/lib/format";
import { loadPlacePhoto } from "@/lib/place-photo-cache";
import type { PlacePhoto, Suggestion } from "@/lib/types";
import type { SuggestionsStatus } from "./SuggestionsPanel";

type Props = {
  status: SuggestionsStatus;
  alternatives: Suggestion[];
  error: string | null;
  onFind: () => void;
  onSwap: (s: Suggestion) => void | Promise<void>;
  onDismissError: () => void;
};

/** Thumbnail from the shared place-photo cache; a missing or broken photo just leaves the space empty. */
function Thumb({ s }: { s: Suggestion }) {
  const [loaded, setLoaded] = useState<{ key: string; photo: PlacePhoto | null } | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void loadPlacePhoto({ key: s.osmId, name: s.name, lat: s.lat, lng: s.lng }).then((photo) => {
      if (current) setLoaded({ key: s.osmId, photo });
    });
    return () => {
      current = false;
    };
  }, [s.osmId, s.name, s.lat, s.lng]);
  const photo = loaded?.key === s.osmId && loaded.photo?.url !== failedUrl ? loaded.photo : null;
  return photo ? (
    // eslint-disable-next-line @next/next/no-img-element -- remote thumbnail from an allow-listed host, validated server-side
    <img src={photo.url} alt={`Photo of ${s.name}`} width={48} height={48} referrerPolicy="no-referrer" onError={() => setFailedUrl(photo.url)} className="h-12 w-12 shrink-0 rounded-lg bg-hover object-cover" />
  ) : (
    <span aria-hidden className="h-12 w-12 shrink-0 rounded-lg bg-hover" />
  );
}

export function AlternativesPanel({ status, alternatives, error, onFind, onSwap, onDismissError }: Props) {
  const { settings } = useSettings();
  const [swapping, setSwapping] = useState<string | null>(null);
  async function swap(s: Suggestion) {
    if (swapping) return;
    setSwapping(s.osmId);
    try {
      await onSwap(s);
    } finally {
      setSwapping(null);
    }
  }
  return (
    <section aria-label="Alternatives" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Alternatives nearby</h3>
        <button type="button" onClick={onFind} disabled={status === "loading"} className={btnSecondary}>
          {status === "loading" ? "Searching…" : "Find alternatives"}
        </button>
      </div>
      {status === "error" && error && <ErrorBanner message={error} onDismiss={onDismissError} />}
      {status === "done" && alternatives.length === 0 && <p className="text-sm text-muted">No other photo spots within {formatRadiusKm(10, settings.distanceUnit)}.</p>}
      <ul className="space-y-1">
        {alternatives.map((s) => (
          <li key={s.osmId} data-testid="alternative-card" className="flex items-center gap-2 rounded-xl py-1">
            <Thumb s={s} />
            <div className="min-w-0 flex-1">
              <p data-testid="alternative-name" className="truncate text-sm font-medium">{s.name}</p>
              <p className="text-xs text-muted">
                <span className="capitalize">{s.kind}</span>
                {formatPhotoCount(s.popularity) && <span data-testid="alternative-popularity"> · {formatPhotoCount(s.popularity)}</span>}
              </p>
            </div>
            <button type="button" disabled={swapping !== null} onClick={() => void swap(s)} aria-label={`Swap in ${s.name}`} className={btnAccent}>
              Swap in
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
