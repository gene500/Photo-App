"use client";

import {
  closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { describeBestTime, type BestTime } from "@/lib/best-time";
import { stopColor } from "@/lib/stop-style";
import type { Stop } from "@/lib/types";

type Handlers = {
  onToggleVisited: (stopId: string, visited: boolean) => void;
  onDelete: (stopId: string) => void;
  onSelect: (stopId: string) => void;
};

type Props = Handlers & { stops: Stop[]; bestTimes: BestTime[]; onReorder: (stopIds: string[]) => void };

export function reorderIds(ids: string[], activeId: string, overId: string): string[] | null {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from === -1 || to === -1 || from === to) return null;
  return arrayMove(ids, from, to);
}

export function StopList({ stops, bestTimes, onReorder, ...handlers }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (stops.length === 0) return <p className="text-sm text-gray-500">No stops yet.</p>;

  const ids = stops.map((s) => s.id);
  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over) return;
    const next = reorderIds(ids, String(active.id), String(over.id));
    if (next) onReorder(next);
  }

  return (
    // A stable id avoids dnd-kit's SSR aria-describedby hydration mismatch.
    <DndContext id="stop-list" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ol className="space-y-2">
          {stops.map((s, i) => (
            <StopRow key={s.id} stop={s} index={i} bestTime={bestTimes[i] ?? null} {...handlers} />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

function StopRow({ stop, index, bestTime, onToggleVisited, onDelete, onSelect }: Handlers & { stop: Stop; index: number; bestTime: BestTime }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stop.id });
  return (
    <li
      ref={setNodeRef}
      data-testid="stop-row"
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-start gap-2 rounded border bg-white p-2 ${isDragging ? "opacity-60" : ""}`}
    >
      <button type="button" data-testid="drag-handle" aria-label={`Reorder ${stop.name}`} className="cursor-grab px-1 text-gray-400" {...attributes} {...listeners}>
        ⋮⋮
      </button>
      <span aria-hidden className="mt-1.5 h-3 w-3 shrink-0 rounded-full" style={{ background: stopColor(stop) }} />
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => onSelect(stop.id)} className="block truncate text-left font-medium hover:underline">
          {index + 1}. {stop.name}
        </button>
        <p data-testid="best-time" className="text-xs text-gray-600">{describeBestTime(bestTime)}</p>
        {stop.notes && <p className="truncate text-xs text-gray-500">{stop.notes}</p>}
      </div>
      {stop.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- user uploads served by an auth-checked route
        <img src={stop.photoUrl} alt="" className="h-10 w-10 rounded object-cover" />
      ) : null}
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" checked={stop.visited} onChange={(e) => onToggleVisited(stop.id, e.target.checked)} />
        Visited
      </label>
      <button type="button" onClick={() => onDelete(stop.id)} aria-label={`Delete ${stop.name}`} className="text-xs text-red-700">
        Delete
      </button>
    </li>
  );
}
