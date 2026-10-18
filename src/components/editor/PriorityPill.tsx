"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { PRIORITIES, PRIORITY_LABEL } from "@/lib/stop-style";
import type { StopPriority } from "@/lib/types";

const PRIORITY_SHORT: Record<StopPriority, string> = { normal: "Normal", high: "High", must: "Must" };

export function PriorityPill({ name, value: saved, onChange }: { name: string; value: StopPriority; onChange: (priority: StopPriority) => void | Promise<unknown> }) {
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
    const result = onChange(target);
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
