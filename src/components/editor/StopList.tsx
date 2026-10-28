"use client";

import { useEffect, useRef } from "react";
import {
  closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type CollisionDetection, type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { centreAlignedKeyboardCoordinates } from "./keyboard-coordinates";
import { StopPhoto } from "./StopPhoto";
import type { Stop } from "@/lib/types";
import { leadingVisited } from "@/lib/visited-run";

type Handlers = {
  onDelete: (stopId: string) => void;
  onSelect: (stopId: string) => void;
};

type Props = Handlers & { stops: Stop[]; onReorder: (stopIds: string[], movedId?: string) => void };

/** `pinned` = how many leading stops are visited: they never move, and nothing lands among them (a drop on one means the first unvisited place). */
export function reorderIds(ids: string[], activeId: string, overId: string, pinned = 0): string[] | null {
  const from = ids.indexOf(activeId);
  let to = ids.indexOf(overId);
  if (from === -1 || to === -1 || from < pinned) return null;
  to = Math.max(to, pinned);
  if (from === to) return null;
  return arrayMove(ids, from, to);
}

/**
 * closestCenter, except that a pointer drag whose pointer is outside the rows (released outside the list) has no drop target,
 * so releasing there cancels the reorder. Keyboard drags have no pointer and always use closestCenter.
 */
export const listCollision: CollisionDetection = (args) => {
  const p = args.pointerCoordinates;
  if (p) {
    const rects = [...args.droppableRects.values()];
    if (rects.length > 0) {
      const left = Math.min(...rects.map((r) => r.left));
      const right = Math.max(...rects.map((r) => r.right));
      const top = Math.min(...rects.map((r) => r.top));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      if (p.x < left || p.x > right || p.y < top || p.y > bottom) return [];
    }
  }
  return closestCenter(args);
};

// dnd-kit's default edge zone is 20% of the scroll area's height, which in the short landscape side panel (about 300 px tall)
// leaves almost no room between a row and the edge: a short drag ran the scroll away. A thin zone and gentler speed keep it bounded.
const AUTO_SCROLL = { threshold: { x: 0.2, y: 0.06 }, acceleration: 4 };

export function StopList({ stops, onReorder, ...handlers }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: centreAlignedKeyboardCoordinates }),
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const prevIds = useRef<string[]>([]);
  const ids = stops.map((s) => s.id);
  const idsKey = ids.join(",");
  const pinned = leadingVisited(stops);
  useEffect(() => {
    const before = prevIds.current;
    prevIds.current = idsKey ? idsKey.split(",") : [];
    // After a delete the focused button is gone and focus drops to the page: put it on the next row (or the last), else the list.
    if (prevIds.current.length >= before.length) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const gone = before.findIndex((id) => !prevIds.current.includes(id));
    const rows = rootRef.current?.querySelectorAll<HTMLElement>('li > button');
    const next = rows && rows.length > 0 ? rows[Math.min(Math.max(gone, 0), rows.length - 1)] : null;
    (next ?? rootRef.current)?.focus();
  }, [idsKey]);

  if (stops.length === 0) return <div ref={rootRef} tabIndex={-1} className="outline-none"><p className="text-sm text-muted">No stops yet.</p></div>;

  // dnd-kit's default announcements read out database ids; the app announces the result itself ("Moved X to position N of M"), so only the pick-up is spoken here, by name.
  const nameOf = (id: string | number) => stops.find((s) => s.id === String(id))?.name ?? "stop";
  const announcements = {
    onDragStart: ({ active }: { active: { id: string | number } }) => `Picked up ${nameOf(active.id)}.`,
    onDragOver: () => undefined,
    onDragEnd: ({ active, over }: { active: { id: string | number }; over: unknown }) => (over ? undefined : `Reordering ${nameOf(active.id)} cancelled.`),
    onDragCancel: ({ active }: { active: { id: string | number } }) => `Reordering ${nameOf(active.id)} cancelled.`,
  };

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over) return;
    const next = reorderIds(ids, String(active.id), String(over.id), pinned);
    if (next) onReorder(next, String(active.id));
  }

  return (
    <div ref={rootRef} tabIndex={-1} className="outline-none">
    {/* A stable id avoids dnd-kit's SSR aria-describedby hydration mismatch. */}
    <DndContext id="stop-list" accessibility={{ announcements }} sensors={sensors} collisionDetection={listCollision} autoScroll={AUTO_SCROLL} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ol>
          {stops.map((s, i) => (
            <StopRow key={s.id} stop={s} index={i} locked={i < pinned} {...handlers} />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
    </div>
  );
}

// Hover-capable pointers reveal the secondary controls on row hover/focus; touch always shows them.
const REVEAL = "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100 focus-visible:!opacity-100";

function StopRow({ stop, index, locked, onDelete, onSelect }: Handlers & { stop: Stop; index: number; locked: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stop.id, disabled: locked });
  return (
    <li
      ref={setNodeRef}
      data-testid="stop-row"
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group relative flex items-center gap-3 rounded-xl px-1 py-1.5 text-foreground ${isDragging ? "z-10 bg-surface opacity-70 shadow-lg" : ""}`}
    >
      <button type="button" onClick={() => onSelect(stop.id)} className="min-w-0 flex-1 break-words text-left text-sm font-medium hover:underline">
        <span className="sr-only">{index + 1}.</span>{" "}{stop.name}
      </button>
      <div className={`flex shrink-0 items-center transition-opacity ${REVEAL}`}>
        {locked ? (
          <button type="button" data-testid="drag-handle" disabled aria-label={`${stop.name} is visited and stays in place`} title="Visited stops stay in place" className="flex h-9 w-8 cursor-not-allowed items-center justify-center rounded-lg text-muted opacity-40">
            ⋮⋮
          </button>
        ) : (
          <button type="button" data-testid="drag-handle" title="Drag to reorder" aria-label={`Reorder ${stop.name}`} className="flex h-9 w-8 cursor-grab touch-none items-center justify-center rounded-lg text-muted hover:bg-hover" {...attributes} {...listeners}>
            ⋮⋮
          </button>
        )}
        <button type="button" onClick={() => onDelete(stop.id)} aria-label={`Delete ${stop.name}`} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger">
          <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      <StopPhoto stop={stop} />
    </li>
  );
}
