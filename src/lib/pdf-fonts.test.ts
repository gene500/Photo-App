// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { loadPdfFonts, parseCmap, pdfText } from "./pdf-fonts";

const file = (name: string) => {
  const b = readFileSync(`public/fonts/${name}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe("parseCmap", () => {
  it("lists the scripts the bundled Noto Sans covers", () => {
    for (const name of ["NotoSans-Regular.ttf", "NotoSans-Bold.ttf"]) {
      const cps = parseCmap(file(name));
      for (const ch of "AzéłŐăễỵДжюΩαβ–’€") expect(cps.has(ch.codePointAt(0)!), `${name} ${ch}`).toBe(true);
      for (const ch of "東あ한مא한ก😀☀") expect(cps.has(ch.codePointAt(0)!), `${name} ${ch}`).toBe(false);
    }
  });
  it("is empty for data that is not a font", () => {
    expect(parseCmap(new ArrayBuffer(8)).size).toBe(0);
    expect(parseCmap(new TextEncoder().encode("<html>nope</html>".repeat(50)).buffer as ArrayBuffer).size).toBe(0);
  });
});

describe("pdfText", () => {
  const latinOnly = (c: number) => c < 0x250;
  it("keeps supported text, normalises, and handles whitespace and controls", () => {
    expect(pdfText("Café\ta\nb\u0007", latinOnly)).toBe("Café a\nb");
  });
  it("replaces each run of unsupported characters with one ?", () => {
    expect(pdfText("Tokyo 東京タワー trip 日本", latinOnly)).toBe("Tokyo ? trip ?");
    expect(pdfText("a東b京c", latinOnly)).toBe("a?b?c");
  });
  it("treats emoji sequences as one run", () => {
    expect(pdfText("Sun ☀️\u{1F600}‍\u{1F600} end", latinOnly)).toBe("Sun ? end");
  });
  it("yields an empty string for empty input", () => {
    expect(pdfText("", latinOnly)).toBe("");
  });
});

describe("loadPdfFonts", () => {
  const ok = (name: string) => new Response(file(name), { status: 200 });
  it("returns both fonts", async () => {
    const fetchImpl = vi.fn(async (u: RequestInfo | URL) => ok(String(u).includes("Bold") ? "NotoSans-Bold.ttf" : "NotoSans-Regular.ttf"));
    const fonts = await loadPdfFonts({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fonts?.regular.byteLength).toBeGreaterThan(100000);
    expect(fonts?.bold.byteLength).toBeGreaterThan(100000);
  });
  it("is null when the network fails, a file is missing or the body is not a font", async () => {
    expect(await loadPdfFonts({ fetchImpl: (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch })).toBeNull();
    expect(await loadPdfFonts({ fetchImpl: (async () => new Response("no", { status: 404 })) as unknown as typeof fetch })).toBeNull();
    expect(await loadPdfFonts({ fetchImpl: (async () => new Response("<html>".repeat(5000))) as unknown as typeof fetch })).toBeNull();
  });
});
