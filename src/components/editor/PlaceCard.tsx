"use client";

import { btnPrimary, card } from "@/components/ui/styles";

type Props = { name: string; resolving: boolean; busy: boolean; onAdd: () => void; onClose: () => void };

export function PlaceCard({ name, resolving, busy, onAdd, onClose }: Props) {
  return (
    <section aria-label="Selected place" className={`flex items-center gap-3 rounded-xl p-3 ${card}`}>
      <p className={`min-w-0 flex-1 text-sm font-medium ${resolving ? "text-muted" : ""}`}>{name}</p>
      <button
        type="button"
        onClick={onAdd}
        disabled={resolving || busy}
        className={`${btnPrimary} shrink-0`}
      >
        Add stop
      </button>
      <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg leading-none text-muted hover:bg-hover">
        ×
      </button>
    </section>
  );
}
