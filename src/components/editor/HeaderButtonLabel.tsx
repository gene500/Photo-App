import type { ReactNode } from "react";

const PATHS = {
  edit: "M2.5 13.5l.7-3L10.6 3.1a1.4 1.4 0 012 2L5.2 12.5l-2.7 1zM9.5 4.2l2.3 2.3",
  export: "M8 2v8M4.8 7L8 10.2 11.2 7M3 13h10",
  share: "M8 10V2.5M5 5l3-3 3 3M3.5 8v5h9V8",
} as const;

/** Header button content: the short text, swapped for an icon below 360 px so the trip name keeps its room (the button's aria-label stays). */
export function HeaderButtonLabel({ icon, children }: { icon: keyof typeof PATHS; children: ReactNode }): ReactNode {
  return (
    <>
      <span className="max-[359px]:hidden">{children}</span>
      <svg aria-hidden viewBox="0 0 16 16" className="hidden h-5 w-5 max-[359px]:block" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <path d={PATHS[icon]} />
      </svg>
    </>
  );
}
