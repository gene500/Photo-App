import { describe, expect, it } from "vitest";
import { hasContent, clampText, stripNameChars, stripTextChars } from "./text";

describe("text hygiene", () => {
  it("strips control and bidi characters from names but keeps zero-width joiners and emoji", () => {
    expect(stripNameChars("a\u0000b\u007Fe\u0085f‮g⁦h⁩")).toBe("abefgh");
    expect(stripNameChars("👨‍👩 Café 日本")).toBe("👨‍👩 Café 日本");
  });
  it("turns tab and newline in names into one space and strips LRM, RLM, ALM and line/paragraph separators", () => {
    expect(stripNameChars("a\tb\nc\r\nd")).toBe("a b c d");
    expect(stripNameChars("a\u200Eb\u200Fc\u061Cd\u2028e\u2029f")).toBe("abcdef");
  });
  it("keeps tab, newline and return in free text", () => {
    expect(stripTextChars("a\tb\nc\r\nd\u0007e\u0000")).toBe("a\tb\nc\r\nde");
  });
  it("strips bidi overrides, isolates, marks and line/paragraph separators from free text but keeps newlines and tabs", () => {
    expect(stripTextChars("a\u202Eb\u202Cc\u2066d\u2069e\u2028f\u2029g\u200Eh\u200Fi\u061Cj")).toBe("abcdefghij");
    expect(stripTextChars("line1\n\tline2\r\nline3 👨‍👩 日本")).toBe("line1\n\tline2\r\nline3 👨‍👩 日本");
  });
  it("clamps without splitting a surrogate pair", () => {
    const s = "a".repeat(199) + "😀";
    expect(clampText(s, 200)).toBe("a".repeat(199));
    expect(clampText("abc", 200)).toBe("abc");
    expect(clampText("abcd", 2)).toBe("ab");
  });

  it("hasContent ignores bidi marks, variation selectors, tag characters and other invisible characters", () => {
    for (const blank of ["\u200E", "\u202E", "\uFE0F", "\u{E0020}", "\u00AD", "\u2800", "\u3164", "\u180E", " \u200B \uFE0F"]) expect(hasContent(blank)).toBe(false);
    expect(hasContent("A")).toBe(true);
    expect(hasContent("\u2764\uFE0F")).toBe(true); // an emoji with a variation selector is visible
    expect(hasContent("\u200E\u0627")).toBe(true);
  });
});
