// Shared class strings so the screens stay visually consistent. Colours come from the tokens in globals.css.

/** Primary action: solid ink pill/rounded button. */
export const btnPrimary =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl bg-ink px-4 py-2 text-sm font-medium text-ink-foreground transition active:scale-[0.97] hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong disabled:opacity-50";

/** Quiet secondary action: soft tinted fill, no border. */
export const btnSecondary =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl bg-hover px-3 py-1.5 text-sm font-medium text-foreground transition active:scale-[0.97] hover:bg-border focus-visible:outline-2 focus-visible:outline-accent-strong disabled:opacity-50";

/** Accent (Accept) action. */
export const btnAccent =
  "inline-flex min-h-9 items-center justify-center rounded-xl bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground transition active:scale-[0.97] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-accent-strong disabled:opacity-50";

/** Text-only quiet button / link. */
export const btnGhost =
  "inline-flex min-h-9 items-center rounded-lg px-2 text-sm text-muted transition active:scale-[0.97] hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent-strong";

export const inputClass =
  "mt-1 w-full rounded-xl bg-hover px-3 py-2 text-foreground placeholder:text-muted outline-none ring-1 ring-border focus:ring-2 focus:ring-accent-strong";

/** Floating white surface. */
export const card = "anim-rise rounded-2xl bg-surface text-foreground shadow-lg ring-1 ring-border";
