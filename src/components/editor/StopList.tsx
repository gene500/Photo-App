"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import {
  closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { centreAlignedKeyboardCoordinates } from "./keyboard-coordinates";
import { describeBestTime, type BestTime } from "@/lib/best-time";
import { describeLightHint } from "@/lib/light-windows";
import { useMounted } from "@/lib/use-mounted";
import { useSettings } from "@/components/settings/SettingsProvider";
import { PRIORITIES, PRIORITY_LABEL, stopColor } from "@/lib/stop-style";
import { useWeatherLine } from "@/lib/use-weather";
import { WeatherText } from "@/components/weather/WeatherIcon";
import type { Stop, StopPriority } from "@/lib/types";

type Handlers = {
  onToggleVisited: (stopId: string, visited: boolean) => void;
  onDelete: (stopId: string) => void;
  onSelect: (stopId: string) => void;
  /** When given, stops with a best light show a small three-part priority pill. */
  /** May return a promise; the pill shows the new value meanwhile and reverts if it rejects. */
  onPriorityChange?: (stopId: string, priority: StopPriority) => void | Promise<unknown>;
};

type Props = Handlers & { stops: Stop[]; bestTimes: BestTime[]; arrivals?: (Date | null)[]; onReorder: (stopIds: string[]) => void };

export function reorderIds(ids: string[], activeId: string, overId: string): string[] | null {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from === -1 || to === -1 || from === to) return null;
  return arrayMove(ids, from, to);
}

const PRIORITY_SHORT: Record<StopPriority, string> = { normal: "Normal", high: "High", must: "Must" };

function PriorityPill({ stopId, name, value: saved, onChange }: { stopId: string; name: string; value: StopPriority; onChange: (stopId: string, priority: StopPriority) => void | Promise<unknown> }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  // The value just chosen, shown until the parent catches up, so rapid key presses build on each other.
  const [pending, setPending] = useState<{ value: StopPriority; for: StopPriority } | null>(null);
  const seq = useRef(0);
  const value = pending && pending.for === saved ? pending.value : saved;
  const index = PRIORITIES.indexOf(value);
  const select = (next: number, focus = false) => {
    const target = PRIORITIES[next];
    if (!target) return;
    if (focus) refs.current[next]?.focus();
    if (target === value) return;
    const mine = ++seq.current;
    setPending({ value: target, for: saved });
    // Without a promise the choice stays until the saved value changes. With one, only the latest request
    // clears it when it settles, so a failed save shows the saved value again.
    const result = onChange(stopId, target);
    if (result) {
      const done = () => { if (mine === seq.current) setPending(null); };
      void result.then(done, done);
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const last = PRIORITIES.length - 1;
    const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? Math.min(index + 1, last)
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? Math.max(index - 1, 0)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    select(next, true);
  };
  return (
    <div role="radiogroup" aria-label={`Priority for ${name}`} className="relative grid w-48 min-w-[8.5rem] max-w-full grid-cols-3 rounded-full bg-hover p-0.5 ring-1 ring-border">
      <span
        aria-hidden
        data-testid="priority-thumb"
        className="pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc((100%-0.25rem)/3)] rounded-full bg-accent shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {PRIORITIES.map((p, i) => (
        <button
          key={p}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          role="radio"
          title={PRIORITY_LABEL[p]}
          aria-label={PRIORITY_LABEL[p]}
          aria-checked={p === value}
          tabIndex={p === value ? 0 : -1}
          onClick={() => select(i)}
          onKeyDown={onKeyDown}
          className={`relative min-h-7 min-w-[2.75rem] truncate rounded-full px-0.5 text-[11px] font-medium focus-visible:outline-2 focus-visible:outline-accent-strong ${p === value ? "text-accent-foreground" : "text-muted hover:text-foreground"}`}
        >
          {PRIORITY_SHORT[p]}
        </button>
      ))}
    </div>
  );
}

export function StopList({ stops, bestTimes, arrivals, onReorder, ...handlers }: Props) {
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
            <StopRow key={s.id} stop={s} index={i} bestTime={bestTimes[i] ?? null} arrival={arrivals?.[i] ?? null}
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

function StopRow({ stop, index, bestTime, arrival, role, first, last, onToggleVisited, onDelete, onSelect, onPriorityChange }: Handlers & { stop: Stop; index: number; bestTime: BestTime; arrival: Date | null; role: "Start" | "End" | null; first: boolean; last: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stop.id });
  const { settings } = useSettings();
  const mounted = useMounted(); // clock text is in the viewer's time zone: only a placeholder until mounted
  const hint = !mounted ? null : describeLightHint(stop, arrival, undefined, settings.timeFormat);
  // Weather at the arrival (or the stop's light window); silent while loading or when it fails.
  const weather = useWeatherLine(stop.lat, stop.lng, arrival, stop.lightPref);
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
        <div className="flex min-w-0 items-center gap-1.5">
          <button type="button" onClick={() => onSelect(stop.id)} className="block min-h-7 min-w-0 truncate text-left text-sm font-medium leading-7 hover:underline">
            <span className="sr-only">{index + 1}.</span>{" "}{stop.name}
          </button>
          {role && <span data-testid="stop-role" className="shrink-0 rounded-md bg-hover px-1.5 py-px text-xs font-medium text-muted">{role}</span>}
        </div>
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
          {hint ? (
            <span data-testid="best-time" data-light-met={hint.met} className={`flex min-w-0 items-center gap-1 ${hint.met ? "" : "text-sand"}`}>
              {hint.met && (
                <svg aria-hidden viewBox="0 0 16 16" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 8.5l3.2 3.2L13 4.8" />
                </svg>
              )}
              <span>{hint.text}</span>
            </span>
          ) : (
            <span data-testid="best-time">{mounted ? describeBestTime(bestTime, undefined, settings.timeFormat) : "\u00A0"}</span>
          )}
        </p>
        {weather && (
          <p data-testid="stop-weather" data-light-quality={weather.quality ?? undefined} title={weather.label} className={`text-xs ${weather.quality === "poor" ? "text-sand" : "text-muted"}`}>
            <WeatherText line={weather} />
          </p>
        )}
        {weather?.warning && <p data-testid="light-warning" className="text-xs text-sand">{weather.warning}</p>}
        {stop.notes && <p className="truncate text-xs text-muted">{stop.notes}</p>}
        {onPriorityChange && stop.lightPref !== "any" && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted" title="Priority: how hard Optimize route works to land this stop in its light">
            <span className="shrink-0">Priority</span>
            <PriorityPill stopId={stop.id} name={stop.name} value={stop.priority} onChange={onPriorityChange} />
          </div>
        )}
      </div>
      {stop.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- user uploads served by an auth-checked route
        <img src={stop.photoUrl} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
      ) : null}
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
