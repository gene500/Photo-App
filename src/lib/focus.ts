/**
 * Keyboard focus helpers. A focused button that is disabled, removed or unmounted drops focus to <body>; the fix is either to
 * keep the button focusable while it is pending (`softDisabled`) or to move focus to a named next control (`focusLost`, `focusFirst`).
 */

/** True when focus has fallen to the page (or sits on something that can no longer take keys). */
export function focusLost(): boolean {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return true;
  return !el.isConnected || (el as HTMLButtonElement).disabled === true;
}

/** Focus the first target that exists and takes focus; false if none did. */
export function focusFirst(...targets: (HTMLElement | null | undefined)[]): boolean {
  for (const el of targets) {
    if (!el || !el.isConnected) continue;
    // Let go first: a target that is hidden (display:none) ignores focus(), and a button that was just pressed would
    // otherwise still count as focused, hiding the failure.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    el.focus();
    if (document.activeElement === el) return true;
  }
  return false;
}

/**
 * Props for a button that is busy or unavailable but must keep keyboard focus: `aria-disabled` instead of `disabled`.
 * The caller leaves its click handler off (`onClick={off ? undefined : fn}`) or guards in the handler; style the off state
 * with `aria-disabled:` classes.
 */
export function softDisabled(off: boolean | undefined) {
  return { "aria-disabled": off || undefined } as const;
}
