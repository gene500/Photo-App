import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { checkPhotoFile, type PhotoType } from "@/lib/photo-rules";

export const PHOTO_URL_PREFIX = "/api/uploads/";

const EXT: Record<PhotoType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const TYPE_BY_EXT: Record<string, PhotoType> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
const NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function uploadDir(): string {
  return path.resolve(process.env.UPLOAD_DIR ?? "uploads");
}

export function sniffImageType(bytes: Uint8Array): PhotoType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && PNG_MAGIC.every((b, i) => bytes[i] === b)) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

export type PhotoCheck = { ok: true; type: PhotoType } | { ok: false; error: string };

export function validatePhoto(file: { type: string; size: number }, bytes: Uint8Array): PhotoCheck {
  const error = checkPhotoFile(file);
  if (error) return { ok: false, error };
  const sniffed = sniffImageType(bytes);
  if (!sniffed || sniffed !== file.type) {
    return { ok: false, error: "File contents don't match an allowed image type" };
  }
  return { ok: true, type: sniffed };
}

export async function savePhoto(bytes: Uint8Array, type: PhotoType): Promise<string> {
  const name = `${randomUUID()}.${EXT[type]}`;
  await mkdir(uploadDir(), { recursive: true });
  await writeFile(path.join(uploadDir(), name), bytes);
  return `${PHOTO_URL_PREFIX}${name}`;
}

export function isValidPhotoName(name: string): boolean {
  return NAME_RE.test(name);
}

export async function readPhoto(
  name: string,
): Promise<{ bytes: Buffer; contentType: PhotoType } | null> {
  if (!isValidPhotoName(name)) return null;
  try {
    const bytes = await readFile(path.join(uploadDir(), name));
    return { bytes, contentType: TYPE_BY_EXT[name.slice(name.lastIndexOf(".") + 1)] };
  } catch {
    return null;
  }
}

export async function deletePhotoFile(photoUrl: string | null | undefined): Promise<void> {
  if (!photoUrl?.startsWith(PHOTO_URL_PREFIX)) return;
  const name = photoUrl.slice(PHOTO_URL_PREFIX.length);
  if (!isValidPhotoName(name)) return;
  await unlink(path.join(uploadDir(), name)).catch(() => undefined);
}
