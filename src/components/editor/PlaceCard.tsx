"use client";

type Props = { name: string; resolving: boolean; busy: boolean; onAdd: () => void; onClose: () => void };

export function PlaceCard({ name, resolving, busy, onAdd, onClose }: Props) {
  return (
    <section aria-label="Selected place" className="flex items-center gap-3 rounded-xl border bg-white p-3 text-gray-900 shadow-lg">
      <p className={`min-w-0 flex-1 text-sm font-medium ${resolving ? "text-gray-500" : ""}`}>{name}</p>
      <button
        type="button"
        onClick={onAdd}
        disabled={resolving || busy}
        className="shrink-0 rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        Add stop
      </button>
      <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 px-1 text-lg leading-none text-gray-500">
        ×
      </button>
    </section>
  );
}
