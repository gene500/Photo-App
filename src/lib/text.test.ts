import { describe, expect, it } from "vitest";
import { clampText, stripNameChars, stripTextChars } from "./text";

describe("text hygiene", () => {
  it("strips control and bidi characters from names but keeps zero-width joiners and emoji", () => {
    expect(stripNameChars("a\u0000b\tc\nd\u007Fe\u0085f‮g⁦h⁩")).toBe("abcdefgh");
    expect(stripNameChars("👨‍👩 Café 日本")).toBe("👨‍👩 Café 日本");
  });
  it("keeps tab, newline and return in free text", () => {
    expect(stripTextChars("a\tb\nc\r\nd\u0007e\u0000")).toBe("a\tb\nc\r\nde");
  });
  it("clamps without splitting a surrogate pair", () => {
    const s = "a".repeat(199) + "😀";
    expect(clampText(s, 200)).toBe("a".repeat(199));
    expect(clampText("abc", 200)).toBe("abc");
    expect(clampText("abcd", 2)).toBe("ab");
  });
});
