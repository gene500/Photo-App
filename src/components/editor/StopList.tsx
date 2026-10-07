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
            <StopRow key={s.id} stop={s} index={i} bestTime={bestTimes[i] ?? null}
              first={i === 0} last={i === stops.length - 1}
              role={stops.length > 1 ? (i === 0 ? "Start" : i === stops.length - 1 ? "End" : null) : null}
              {...handlers}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

// Hover-capable pointers reveal the secondary controls on row hover/focus; touch always shows them.
const REVEAL = "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100 focus-visible:!opacity-100";

function StopRow({ stop, index, bestTime, role, first, last, onToggleVisited, onDelete, onSelect }: Handlers & { stop: Stop; index: number; bestTime: BestTime; role: "Start" | "End" | null; first: boolean; last: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stop.id });
  // The timeline line runs through the dot centre (22px down) and stops at the first/last dot.
  const line = first && last ? "hidden" : first ? "top-[22px] bottom-0" : last ? "top-0 h-[22px]" : "inset-y-0";
  return (
    <li
      ref={setNodeRef}
      data-testid="stop-row"
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group relative flex items-start gap-3 rounded-xl py-2 pr-1 text-foreground ${isDragging ? "z-10 bg-surface opacity-70 shadow-lg" : ""}`}
    >
      <span aria-hidden className={`absolute left-[13px] w-px bg-border ${line}`} />
      {/* The dot is the Visited toggle: a real checkbox laid invisibly over it. */}
      <span
        className={`relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-4 ring-surface ${stop.visited ? "text-black/75" : "text-white"}`}
        style={{ background: stopColor(stop) }}
      >
        <input
          type="checkbox"
          aria-label="Visited"
          className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
          checked={stop.visited}
          onChange={(e) => onToggleVisited(stop.id, e.target.checked)}
        />
        {stop.visited ? (
          <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 8.5l3.2 3.2L13 4.8" />
          </svg>
        ) : (
          <span aria-hidden>{index + 1}</span>
        )}
        <span aria-hidden className="pointer-events-none absolute -inset-1 rounded-full ring-2 ring-accent-strong opacity-0 peer-focus-visible:opacity-100" />
      </span>
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => onSelect(stop.id)} className="block min-h-7 w-full truncate text-left text-sm font-medium leading-7 hover:underline">
          <span className="sr-only">{index + 1}.</span>{" "}{stop.name}
        </button>
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
          {role && <span data-testid="stop-role" className="shrink-0 rounded-md bg-hover px-1.5 py-px text-[11px] font-medium">{role}</span>}
          <span data-testid="best-time" className="truncate">{describeBestTime(bestTime)}</span>
        </p>
        {stop.notes && <p className="truncate text-xs text-muted">{stop.notes}</p>}
      </div>
      {stop.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- user uploads served by an auth-checked route
        <img src={stop.photoUrl} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
      ) : null}
      <div className={`flex shrink-0 items-center transition-opacity ${REVEAL}`}>
        <button type="button" data-testid="drag-handle" aria-label={`Reorder ${stop.name}`} className="flex h-9 w-8 cursor-grab touch-none items-center justify-center rounded-lg text-muted hover:bg-hover" {...attributes} {...listeners}>
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
