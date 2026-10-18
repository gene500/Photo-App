// Names: tab, newline and the like become one space; no other control characters (C0, DEL, C1), no bidi marks,
// overrides or isolates (LRM, RLM, ALM, LRE..RLO, LRI..PDI), and no line/paragraph separators.
const NAME_SPACES = /[\t\n\v\f\r]+/g;
const NAME_FORBIDDEN = /[\u0000-\u001F\u007F-\u009F\u061C\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g;
// Free text may keep \t \n \r but no other control character, and none of the bidi / separator set names refuse
// (otherwise a note can reorder how it is displayed, "Trojan Source").
const TEXT_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u061C\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g;

/** Removes the characters a one-line name may not hold (stored data and upstream names are cleaned, not rejected). */
export const stripNameChars = (s: string) => s.replace(NAME_SPACES, " ").replace(NAME_FORBIDDEN, "");
export const stripTextChars = (s: string) => s.replace(TEXT_FORBIDDEN, "");

/** Cuts to at most `max` UTF-16 units without leaving half of a surrogate pair at the end. */
export function clampText(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.charCodeAt(max - 1);
  return s.slice(0, cut >= 0xd800 && cut <= 0xdbff ? max - 1 : max);
}
