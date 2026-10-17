const be16 = (n: number) => [n >> 8, n & 255];
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const chunk = (type: string, data: number[] = []) => [...be32(data.length), ...ascii(type), ...data, 0, 0, 0, 0];

/** A structurally valid (not decodable) 20x10 PNG; the server checks structure, not pixels. */
export const tinyPng = () =>
  Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk("IHDR", [...be32(20), ...be32(10), 8, 2, 0, 0, 0]), ...chunk("IDAT", [1, 2, 3, 4]), ...chunk("IEND")]);

/** A 40x30 JPEG skeleton whose EXIF block carries a GPS marker string. */
export const jpegWithGps = () => {
  const seg = (m: number, p: number[]) => [0xff, m, ...be16(p.length + 2), ...p];
  const exif = seg(0xe1, [...ascii("Exif\0\0"), ...ascii("MM"), 0, 42, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, ...ascii("GPSLatitude=37.77")]);
  return Uint8Array.from([0xff, 0xd8, ...exif, ...seg(0xc0, [8, ...be16(30), ...be16(40), 1, 1, 0x11, 0]), ...seg(0xda, [1, 1, 0, 0, 63, 0]), 0x12, 0x34, 0xff, 0xd9]);
};
