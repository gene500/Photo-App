// @vitest-environment node
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

describe("pdfSafe", () => {
  it("replaces characters above U+00FF and strips control characters", () => {
    const out = pdfSafe("Café – 東京 ☀️\u0007");
    expect(out).toContain("Café");
    expect(out).not.toContain("\u0007");
    expect([...out].every((c) => c.codePointAt(0)! <= 0xff)).toBe(true);
  });

  it("keeps newlines", () => {
    expect(pdfSafe("a\nb")).toBe("a\nb");
  });
});
