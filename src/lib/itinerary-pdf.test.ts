// @vitest-environment node
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { ItineraryInput, ItineraryStop } from "./itinerary";
import { pdfSafe, renderItineraryPdf, type PdfMap } from "./itinerary-pdf";

// A valid 64x64 RGB PNG of pseudo-random noise (does not compress away), built without a canvas.
function noisePng(): string {
  const size = 64;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let seed = 12345;
  for (let i = 0; i < raw.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    raw[i] = i % (size * 3 + 1) === 0 ? 0 : seed >> 16;
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

function stop(i: number, over: Partial<ItineraryStop> = {}): ItineraryStop {
  return { index: i, name: `Stopname${i}`, arrival: "9:00 AM", bestLight: "Best at sunrise", weather: "Clear skies", notes: "Bring a tripod", ...over };
}

function input(n: number, over: Partial<ItineraryStop> = {}): ItineraryInput {
  return {
    tripName: "Coastal Tripname",
    dateLine: "Planned for 2026-10-16",
    startLine: "Starts 7:00 AM",
    routeLine: "12 mi · 1 h 5 min",
    note: null,
    stops: Array.from({ length: n }, (_, i) => stop(i + 1, over)),
  };
}

const geometry: [number, number][] = [[-122.4, 37.7], [-122.3, 37.8], [-122.2, 37.75]];
const latLng = [{ lat: 37.7, lng: -122.4 }, { lat: 37.75, lng: -122.2 }];
const fallback: PdfMap = { kind: "fallback" };

async function render(i: ItineraryInput, map: PdfMap = fallback) {
  const blob = await renderItineraryPdf(i, map, geometry, latLng);
  return Buffer.from(await blob.arrayBuffer()).toString("latin1");
}

type Placed = { x: number; y: number; text: string; page: number };
/** Every drawn text with its page and PDF position (origin bottom-left), read back from the page streams. */
function placed(pdf: string): Placed[] {
  const out: Placed[] = [];
  let page = 0;
  for (const chunk of pdf.split("\nstream\n").slice(1)) {
    const body = chunk.split("\nendstream")[0];
    if (!body.includes("Tj")) continue;
    page++;
    for (const m of body.matchAll(/([\d.]+) ([\d.]+) Td\n\((.*)\) Tj/g)) out.push({ x: Number(m[1]), y: Number(m[2]), text: m[3], page });
  }
  return out;
}

const pageCount = (s: string) => (s.match(/\/Type \/Page(?!s)/g) ?? []).length;

describe("renderItineraryPdf", () => {
  it("produces a PDF containing the trip and stop names", async () => {
    const s = await render(input(2));
    expect(s.startsWith("%PDF")).toBe(true);
    expect(s).toContain("Coastal Tripname");
    expect(s).toContain("Stopname1");
    expect(s).toContain("Stopname2");
  });

  it("works with the fallback map and two stops", async () => {
    const blob = await renderItineraryPdf(input(2), fallback, geometry, latLng);
    expect(blob.size).toBeGreaterThan(500);
  });

  it("embeds an image map, making the file larger than the fallback", async () => {
    const a = await renderItineraryPdf(input(2), fallback, geometry, latLng);
    const b = await renderItineraryPdf(input(2), { kind: "image", dataUrl: noisePng() }, geometry, latLng);
    expect(b.size).toBeGreaterThan(a.size);
  });

  it("paginates with Page n of N footers", async () => {
    const few = pageCount(await render(input(2)));
    const s = await render(input(40));
    const many = pageCount(s);
    expect(many).toBeGreaterThan(few);
    expect(s).toContain(`Page 1 of ${many}`);
    expect(s).toContain(`Page ${many} of ${many}`);
  });

  it("wraps very long names and notes without throwing", async () => {
    const notes = "abcd ".repeat(400).trim();
    const s = await render(input(1, { name: "N".repeat(400), notes }));
    expect((s.match(/abcd/g) ?? []).length).toBe(400);
  });

  it("prints no null/undefined for empty fields", async () => {
    const s = await render(input(2, { bestLight: null, weather: null, notes: null }));
    expect(s).not.toMatch(/\((?:[^()]*\b)?(?:null|undefined)\b/);
    expect(s).not.toContain("undefined");
  });
});

describe("note and large routes", () => {
  it("prints the note when given and nothing when null", async () => {
    expect(await render({ ...input(1), note: "Times are estimates notetext." })).toContain("Times are estimates notetext.");
    expect(await render(input(1))).not.toContain("estimates");
  });

  it("renders a 50,000-point route without throwing and stays small", async () => {
    const big: [number, number][] = Array.from({ length: 50000 }, (_, i) => [-122 + i / 50000, 37 + Math.sin(i / 500) / 10]);
    const blob = await renderItineraryPdf(input(2), fallback, big, latLng);
    expect(blob.size).toBeLessThan(200 * 1024);
  });
});

describe("edge cases", () => {
  const noNaN = (s: string) => expect(s).not.toMatch(/NaN|Infinity/);

  it("draws WinAnsi punctuation as its cp1252 byte", async () => {
    const s = await render(input(1, { notes: "a\u2013b" }));
    expect(s).toContain("a\x96b");
  });

  it("drops non-finite coordinates instead of throwing", async () => {
    const stops = [{ lat: NaN, lng: 20 }, { lat: 10, lng: Infinity }, { lat: 11, lng: 21 }, { lat: 12, lng: 22 }];
    const geo: [number, number][] = [[NaN, 1], [20, 10], [Infinity, 3], [21, 11], [22, 12]];
    const blob = await renderItineraryPdf(input(4), fallback, geo, stops);
    noNaN(Buffer.from(await blob.arrayBuffer()).toString("latin1"));
    const blob2 = await renderItineraryPdf(input(2), fallback, [], [{ lat: NaN, lng: NaN }, { lat: Infinity, lng: 1 }]);
    noNaN(Buffer.from(await blob2.arrayBuffer()).toString("latin1"));
  });

  it("falls back to the drawn map when the image data is bad", async () => {
    const blob = await renderItineraryPdf(input(2), { kind: "image", dataUrl: "data:image/png;base64,AAAA" }, [[20, 10], [21, 11]], [{ lat: 10, lng: 20 }, { lat: 11, lng: 21 }]);
    expect(blob.size).toBeGreaterThan(500);
  });

  it("handles identical points", async () => {
    const same = { lat: 10, lng: 20 };
    const blob = await renderItineraryPdf(input(2), fallback, [[20, 10], [20, 10]], [same, same]);
    noNaN(Buffer.from(await blob.arrayBuffer()).toString("latin1"));
  });

  it("draws an antimeridian route as a short hop, not a line across the whole world", async () => {
    const blob = await renderItineraryPdf(input(1), fallback, [[179, 0], [-179, 1], [-178, 2]], [{ lat: 0, lng: 179 }, { lat: 2, lng: -178 }]);
    const s = Buffer.from(await blob.arrayBuffer()).toString("latin1");
    noNaN(s);
    const marks = placed(s).filter((t) => t.text === "1" || t.text === "2");
    expect(marks).toHaveLength(2);
    const [a, b] = marks;
    // Unwrapped, the 3-degree hop fills the box in both directions; wrapped the other way it would be a flat line with the pins at its two ends.
    expect(b.x - a.x).toBeGreaterThan(250);
    expect(b.y - a.y).toBeGreaterThan(150);
    // The route polyline runs from the first pin to the second without leaving the map box (x 40..555).
    const pts = [...s.matchAll(/([\d.]+) ([\d.]+) [ml]\n/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(pts.length).toBeGreaterThanOrEqual(3);
    for (const [x] of pts) expect(x).toBeGreaterThanOrEqual(40);
    for (const [x] of pts) expect(x).toBeLessThanOrEqual(555.3);
  });

  it("handles empty geometry and stops", async () => {
    const blob = await renderItineraryPdf(input(0), fallback, [], []);
    const s = Buffer.from(await blob.arrayBuffer()).toString("latin1");
    expect(s.startsWith("%PDF")).toBe(true);
    noNaN(s);
  });

  it("breaks a very long title across pages and keeps every line above the footer", async () => {
    const s = await render({ ...input(2), tripName: "Title ".repeat(300) });
    const texts = placed(s);
    const body = texts.filter((t) => !t.text.startsWith("Page "));
    expect(body.filter((t) => t.text.startsWith("Title")).reduce((n, t) => n + (t.text.match(/Title/g) ?? []).length, 0)).toBe(300);
    const pages = pageCount(s);
    expect(pages).toBeGreaterThan(2);
    expect(new Set(body.filter((t) => t.text.startsWith("Title")).map((t) => t.page)).size).toBeGreaterThan(1);
    // Nothing is drawn below the body limit (A4 height 841.89 - 40 margin - 30 footer) or above the top margin.
    for (const t of body) {
      expect(t.y, t.text).toBeGreaterThanOrEqual(70);
      expect(t.y, t.text).toBeLessThanOrEqual(841.89 - 40);
    }
    // The stops still follow the title and the footers count every page.
    expect(body.some((t) => t.text === "1. Stopname1")).toBe(true);
    expect(s).toContain(`Page ${pages} of ${pages}`);
  });

  it("breaks a very long note across pages too", async () => {
    const s = await render({ ...input(1), note: "estimate ".repeat(900) });
    const body = placed(s).filter((t) => !t.text.startsWith("Page "));
    expect(body.reduce((n, t) => n + (t.text.match(/estimate/g) ?? []).length, 0)).toBe(900);
    for (const t of body) expect(t.y, t.text).toBeGreaterThanOrEqual(70);
  });

  it("never leaves a stop heading alone at the bottom of a page", async () => {
    // Sweep stop counts so some heading lands at each position near a page end.
    for (let k = 1; k <= 12; k++) {
      const base = input(30);
      // Vary each stop's height so headings land at many offsets near a page end.
      base.stops.forEach((st, i) => {
        st.notes = "word ".repeat(((i * k) % 7) * 20);
        if (!st.notes) st.notes = null;
      });
      const n = k;
      const s = await render(base);
      const pages = s.split("\nstream\n").slice(1);
      expect(pages.length).toBeGreaterThan(0);
      for (const [i, page] of pages.entries()) {
        const texts = [...page.matchAll(/\(([^)]*)\) Tj/g)].map((m) => m[1]).filter((t) => !t.startsWith("Page "));
        // A heading is followed by its arrival time, so an orphan ends with [heading, arrival].
        const last = texts[texts.length - 2];
        if (last && /^\d+\. Stopname/.test(last) && page.includes("Tj")) {
          throw new Error(`heading orphaned on page ${i + 1} in variant ${n}: ${last}`);
        }
      }
    }
  });
});

describe("pdfSafe", () => {
  it("composes decomposed accents", () => {
    expect(pdfSafe("Cafe\u0301")).toBe("Caf\u00e9");
  });
  it("replaces characters above U+00FF and strips control characters", () => {
    const out = pdfSafe("Café – ’ 東京 ☀️\u0007");
    expect(out).toContain("Café");
    expect(out).toContain("–");
    expect(out).toContain("’");
    expect(out).not.toMatch(/[東京☀]/);
    expect(out).not.toContain("\u0007");
    expect([...out].every((c) => c.codePointAt(0)! <= 0xff || "–’".includes(c))).toBe(true);
  });

  it("maps tab to a space", () => {
    expect(pdfSafe("a\tb")).toBe("a b");
  });

  it("keeps newlines", () => {
    expect(pdfSafe("a\nb")).toBe("a\nb");
  });
});

describe("Unicode font", () => {
  const font = (name: string) => {
    const b = readFileSync(`public/fonts/${name}`);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
  const fonts = { regular: font("NotoSans-Regular.ttf"), bold: font("NotoSans-Bold.ttf") };
  const renderWith = async (i: ItineraryInput, f: typeof fonts | null) =>
    Buffer.from(await (await renderItineraryPdf(i, fallback, geometry, latLng, f)).arrayBuffer()).toString("latin1");
  // jsPDF writes a ToUnicode CMap per embedded font: lines of <glyph id><code point>.
  const mapped = (s: string) => new Set([...s.matchAll(/<[0-9a-f]{4}><([0-9a-f]{4})>/gi)].map((m) => parseInt(m[1], 16)));

  it("embeds Noto Sans and every Cyrillic, Greek and Vietnamese letter of the trip name", async () => {
    const name = "Москва Ελλάδα Hà Nội";
    const s = await renderWith({ ...input(1), tripName: name }, fonts);
    expect(s).toContain("/BaseFont /NotoSans");
    expect(s).toContain("/Identity-H");
    const codes = mapped(s);
    for (const ch of new Set(name.normalize("NFC").replace(/ /g, ""))) expect(codes.has(ch.codePointAt(0)!), ch).toBe(true);
    expect(s).not.toContain("Москва");
  });

  it("shows a ? for scripts the font lacks instead of garbage, in stop names and notes", async () => {
    const s = await renderWith(input(1, { name: "東京タワー", notes: "Ελλάδα 😀" }), fonts);
    const codes = mapped(s);
    expect(codes.has("?".codePointAt(0)!)).toBe(true);
    expect(codes.has("東".codePointAt(0)!)).toBe(false);
    expect(codes.has("😀".codePointAt(0)!)).toBe(false);
  });

  it("without the font keeps the built-in fonts and the same placeholder rule", async () => {
    const s = await renderWith({ ...input(1), tripName: "Москва" }, null);
    expect(s).not.toContain("/BaseFont /NotoSans");
    expect(s).toContain("/BaseFont /Helvetica-Bold");
    expect(s).toContain("(?)");
  });

  it("falls back instead of failing when the font data is unreadable", async () => {
    const bad = { regular: new ArrayBuffer(100), bold: new ArrayBuffer(100) };
    const s = await renderWith({ ...input(1), tripName: "Москва" }, bad);
    expect(s.startsWith("%PDF")).toBe(true);
    expect(s).toContain("(?)");
  });
});
