import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tinyPng } from "../../tests/helpers/images";
import {
  deletePhotoFile, isValidPhotoName, PHOTO_URL_PREFIX, readPhoto, savePhoto, sniffImageType, validatePhoto,
} from "./photos";

const PNG_BYTES = tinyPng();
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP_BYTES = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");

describe("photos", () => {
  afterEach(() => rmSync(process.env.UPLOAD_DIR!, { recursive: true, force: true }));

  it("sniffs JPEG, PNG and WebP magic bytes", () => {
    expect(sniffImageType(JPEG_BYTES)).toBe("image/jpeg");
    expect(sniffImageType(PNG_BYTES)).toBe("image/png");
    expect(sniffImageType(WEBP_BYTES)).toBe("image/webp");
    expect(sniffImageType(new TextEncoder().encode("hello world!"))).toBeNull();
  });

  it("rejects files whose bytes do not match the declared type", () => {
    expect(validatePhoto({ type: "image/png", size: 12 }, JPEG_BYTES)).toEqual({
      ok: false,
      error: "File contents don't match an allowed image type",
    });
    expect(validatePhoto({ type: "image/png", size: PNG_BYTES.length }, PNG_BYTES)).toEqual({ ok: true, type: "image/png", bytes: PNG_BYTES });
    expect(validatePhoto({ type: "image/png", size: 8 }, PNG_BYTES.slice(0, 8))).toMatchObject({ ok: false });
  });

  it("saves, reads back, and deletes a photo", async () => {
    const url = await savePhoto(PNG_BYTES, "image/png");
    expect(url.startsWith(PHOTO_URL_PREFIX)).toBe(true);
    const name = url.slice(PHOTO_URL_PREFIX.length);
    expect(isValidPhotoName(name)).toBe(true);
    const read = await readPhoto(name);
    expect(read!.contentType).toBe("image/png");
    expect(new Uint8Array(read!.bytes)).toEqual(PNG_BYTES);
    await deletePhotoFile(url);
    expect(existsSync(path.join(process.env.UPLOAD_DIR!, name))).toBe(false);
  });

  it("refuses path traversal and unknown names", async () => {
    expect(isValidPhotoName("../../etc/passwd")).toBe(false);
    expect(await readPhoto("../package.json")).toBeNull();
    await expect(deletePhotoFile("/api/uploads/../package.json")).resolves.toBe(true);
  });
});

describe("deletePhotoFile result", () => {
  it("reports true for a missing file and for non-photo urls", async () => {
    await expect(deletePhotoFile(null)).resolves.toBe(true);
    await expect(deletePhotoFile("/api/uploads/00000000-0000-0000-0000-000000000000.jpg")).resolves.toBe(true);
  });
});
