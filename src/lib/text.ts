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

/** Characters that draw nothing: bidi marks and isolates, soft hyphen, Mongolian vowel separator, invisible operators, combining grapheme joiner,
 *  Hangul and Khmer fillers, Braille blank, variation selectors, and tag characters. A name made only of these looks blank. */
const INVISIBLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFE00-\uFE0F\uFEFF\uFFA0\u{1D159}\u{1D173}-\u{1D17A}\u{E0000}-\u{E01EF}]/gu;

/** True when the text holds something visible: zero-width characters and whitespace do not count (same rule as names). */
export const hasContent = (s: string) => s.replace(INVISIBLE, "").trim().length > 0;
