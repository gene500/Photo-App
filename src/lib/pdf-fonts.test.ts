// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { cjkScriptFor, loadPdfFonts, parseCmap, pdfText } from "./pdf-fonts";

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

describe("cjkScriptFor", () => {
  it("is null for Latin, Cyrillic, Greek, Vietnamese and for scripts we deliberately leave out", () => {
    for (const t of ["Yosemite", "Москва Ελλάδα Hà Nội", "", "مكة", "תל אביב", "กรุงเทพ", "दिल्ली", "😀 ☀"]) expect(cjkScriptFor(t), t).toBeNull();
  });
  it("picks the Chinese/Japanese file for Han and kana, the Korean file for Hangul", () => {
    expect(cjkScriptFor("日本語の場所")).toBe("sc");
    expect(cjkScriptFor("タワー")).toBe("sc");
    expect(cjkScriptFor("서울 한국")).toBe("kr");
  });
  it("takes the script with more characters when a trip mixes them", () => {
    expect(cjkScriptFor("서울 한국 東")).toBe("kr");
    expect(cjkScriptFor("東京 大阪 서")).toBe("sc");
  });
});

describe("loadPdfFonts with text", () => {
  const bytes = (name: string) => new Response(file(name), { status: 200 });
  const serve = (calls: string[], over: Record<string, () => Response | Promise<Response>> = {}) =>
    (async (u: RequestInfo | URL) => {
      const url = String(u);
      calls.push(url);
      const name = url.split("/").pop()!;
      return over[name] ? over[name]() : bytes(name);
    }) as unknown as typeof fetch;

  it("requests exactly the two base fonts for Latin text", async () => {
    const calls: string[] = [];
    const fonts = await loadPdfFonts({ fetchImpl: serve(calls), text: "Café Москва Hà Nội" });
    expect(calls.sort()).toEqual(["/fonts/NotoSans-Bold.ttf", "/fonts/NotoSans-Regular.ttf"]);
    expect(fonts?.cjk).toBeUndefined();
  });
  it("requests exactly the two base fonts when no text is given", async () => {
    const calls: string[] = [];
    await loadPdfFonts({ fetchImpl: serve(calls) });
    expect(calls).toHaveLength(2);
  });
  it("adds only the Chinese/Japanese file for Han text", async () => {
    const calls: string[] = [];
    const fonts = await loadPdfFonts({ fetchImpl: serve(calls), text: "東京 trip" });
    expect(calls.sort()).toEqual(["/fonts/NotoSans-Bold.ttf", "/fonts/NotoSans-Regular.ttf", "/fonts/NotoSansSC-Regular.ttf"]);
    expect(fonts?.cjk?.script).toBe("sc");
  });
  it("adds only the Korean file for Hangul text", async () => {
    const calls: string[] = [];
    const fonts = await loadPdfFonts({ fetchImpl: serve(calls), text: "서울" });
    expect(calls.filter((c) => c.includes("Noto")).sort()).toEqual(["/fonts/NotoSans-Bold.ttf", "/fonts/NotoSans-Regular.ttf", "/fonts/NotoSansKR-Regular.ttf"]);
    expect(fonts?.cjk?.script).toBe("kr");
  });
  it("keeps the base fonts when the CJK file is missing, offline, not a font, the wrong script or too slow", async () => {
    const cases: Record<string, () => Response | Promise<Response>>[] = [
      { "NotoSansSC-Regular.ttf": () => new Response("no", { status: 404 }) },
      { "NotoSansSC-Regular.ttf": () => { throw new TypeError("offline"); } },
      { "NotoSansSC-Regular.ttf": () => new Response("<html>".repeat(5000)) },
      { "NotoSansSC-Regular.ttf": () => bytes("NotoSansKR-Regular.ttf") },
      { "NotoSansSC-Regular.ttf": () => new Promise<Response>(() => {}) },
    ];
    for (const over of cases) {
      const fonts = await loadPdfFonts({ fetchImpl: serve([], over), text: "東京", cjkTimeoutMs: 20 });
      expect(fonts?.regular.byteLength).toBeGreaterThan(100000);
      expect(fonts?.cjk).toBeUndefined();
    }
  });
  it("is still null when the base fonts fail, whatever the CJK file does", async () => {
    expect(await loadPdfFonts({ fetchImpl: serve([], { "NotoSans-Bold.ttf": () => new Response("no", { status: 404 }) }), text: "東京" })).toBeNull();
  });
});

describe("shipped CJK fonts", () => {
  it("cover their script, Latin/Cyrillic/Greek, and stay small", () => {
    const sc = parseCmap(file("NotoSansSC-Regular.ttf"));
    const kr = parseCmap(file("NotoSansKR-Regular.ttf"));
    for (const ch of "東京都北京上海タワーひらがな。、Москва Ελλάδα Hà Nội") expect(sc.has(ch.codePointAt(0)!), ch).toBe(true);
    for (const ch of "서울한국대전 Hà Nội") expect(kr.has(ch.codePointAt(0)!), ch).toBe(true);
    expect(file("NotoSansSC-Regular.ttf").byteLength).toBeLessThan(4_000_000);
    expect(file("NotoSansKR-Regular.ttf").byteLength).toBeLessThan(2_000_000);
  });
});
