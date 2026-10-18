"use client";

import {
  closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { centreAlignedKeyboardCoordinates } from "./keyboard-coordinates";
import { StopPhoto } from "./StopPhoto";
import type { Stop } from "@/lib/types";

type Handlers = {
  onDelete: (stopId: string) => void;
  onSelect: (stopId: string) => void;
};

type Props = Handlers & { stops: Stop[]; onReorder: (stopIds: string[]) => void };

export function reorderIds(ids: string[], activeId: string, overId: string): string[] | null {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from === -1 || to === -1 || from === to) return null;
  return arrayMove(ids, from, to);
}

export function StopList({ stops, onReorder, ...handlers }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: centreAlignedKeyboardCoordinates }),
  );

  if (stops.length === 0) return <p className="text-sm text-muted">No stops yet.</p>;

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
        <ol>
          {stops.map((s, i) => (
            <StopRow key={s.id} stop={s} index={i} {...handlers} />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

// Hover-capable pointers reveal the secondary controls on row hover/focus; touch always shows them.
const REVEAL = "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100 focus-visible:!opacity-100";

function StopRow({ stop, index, onDelete, onSelect }: Handlers & { stop: Stop; index: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stop.id });
  return (
    <li
      ref={setNodeRef}
      data-testid="stop-row"
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group relative flex items-center gap-3 rounded-xl px-1 py-1.5 text-foreground ${isDragging ? "z-10 bg-surface opacity-70 shadow-lg" : ""}`}
    >
      <StopPhoto stop={stop} />
      <button type="button" onClick={() => onSelect(stop.id)} className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline">
        <span className="sr-only">{index + 1}.</span>{" "}{stop.name}
      </button>
      <div className={`flex shrink-0 items-center transition-opacity ${REVEAL}`}>
        <button type="button" data-testid="drag-handle" title="Drag to reorder" aria-label={`Reorder ${stop.name}`} className="flex h-9 w-8 cursor-grab touch-none items-center justify-center rounded-lg text-muted hover:bg-hover" {...attributes} {...listeners}>
          ⋮⋮
        </button>
        <button type="button" onClick={() => onDelete(stop.id)} aria-label={`Delete ${stop.name}`} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger">
          <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    </li>
  );
}
