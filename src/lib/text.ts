// Names: no control characters (C0, DEL, C1) and no bidi overrides/isolates.
const NAME_FORBIDDEN = /[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/g;
// Free text may keep \t \n \r but no other control character.
const TEXT_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/** Removes the characters a one-line name may not hold (stored data and upstream names are cleaned, not rejected). */
export const stripNameChars = (s: string) => s.replace(NAME_FORBIDDEN, "");
export const stripTextChars = (s: string) => s.replace(TEXT_FORBIDDEN, "");

/** Cuts to at most `max` UTF-16 units without leaving half of a surrogate pair at the end. */
export function clampText(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.charCodeAt(max - 1);
  return s.slice(0, cut >= 0xd800 && cut <= 0xdbff ? max - 1 : max);
}
