import { del, get, put } from "@vercel/blob";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { checkPhotoFile, type PhotoType } from "@/lib/photo-rules";
import { prisma } from "./db";

export const PHOTO_URL_PREFIX = "/api/uploads/";

const EXT: Record<PhotoType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const TYPE_BY_EXT: Record<string, PhotoType> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
const NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// On Vercel there is no persistent disk, so photos live in a private Blob store
// (enabled by BLOB_READ_WRITE_TOKEN). Locally they stay in UPLOAD_DIR.
const blobEnabled = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const blobPath = (name: string) => `photos/${name}`;

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
  if (blobEnabled()) {
    await put(blobPath(name), Buffer.from(bytes), { access: "private", contentType: type, addRandomSuffix: false });
    return `${PHOTO_URL_PREFIX}${name}`;
  }
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
  const contentType = TYPE_BY_EXT[name.slice(name.lastIndexOf(".") + 1)];
  if (blobEnabled()) {
    try {
      const result = await get(blobPath(name), { access: "private" });
      if (!result?.stream) return null;
      return { bytes: Buffer.from(await new Response(result.stream).arrayBuffer()), contentType };
    } catch {
      return null;
    }
  }
  try {
    const bytes = await readFile(path.join(uploadDir(), name));
    return { bytes, contentType };
  } catch {
    return null;
  }
}

/** Removes the stored file. True when it is gone (including already gone); false when removal failed. */
export async function removeStoredPhoto(photoUrl: string | null | undefined): Promise<boolean> {
  if (!photoUrl?.startsWith(PHOTO_URL_PREFIX)) return true;
  const name = photoUrl.slice(PHOTO_URL_PREFIX.length);
  if (!isValidPhotoName(name)) return true;
  try {
    if (blobEnabled()) await del(blobPath(name));
    else await unlink(path.join(uploadDir(), name));
    return true;
  } catch (e) {
    if ((e as { code?: unknown }).code === "ENOENT") return true; // already gone
    console.error(`photo ${name} could not be removed`);
    return false;
  }
}

/**
 * Removes a stored photo. When that fails, the photo is queued in the database so a later retry can finish the job
 * instead of leaving the file in storage for good. Resolves false when the file could not be removed right now.
 */
export async function deletePhotoFile(photoUrl: string | null | undefined): Promise<boolean> {
  const ok = await removeStoredPhoto(photoUrl);
  if (!ok && photoUrl) {
    try {
      await prisma.pendingPhotoDeletion.upsert({ where: { photoUrl }, create: { photoUrl }, update: {} });
    } catch {
      console.error("photo cleanup could not be queued");
    }
  }
  return ok;
}

export const MAX_CLEANUP_ATTEMPTS = 8;

/** Retries queued photo removals (oldest first). Safe to run repeatedly: a photo that is already gone counts as done. */
export async function retryPendingDeletions(batch = 25): Promise<{ removed: number; failed: number; gaveUp: number }> {
  const rows = await prisma.pendingPhotoDeletion.findMany({
    where: { attempts: { lt: MAX_CLEANUP_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
    take: batch,
  });
  let removed = 0;
  let failed = 0;
  for (const row of rows) {
    if (await removeStoredPhoto(row.photoUrl)) {
      await prisma.pendingPhotoDeletion.deleteMany({ where: { photoUrl: row.photoUrl } });
      removed++;
    } else {
      await prisma.pendingPhotoDeletion.update({ where: { photoUrl: row.photoUrl }, data: { attempts: { increment: 1 } } });
      failed++;
    }
  }
  const gaveUp = await prisma.pendingPhotoDeletion.count({ where: { attempts: { gte: MAX_CLEANUP_ATTEMPTS } } });
  if (gaveUp > 0) console.error(`photo cleanup: ${gaveUp} file(s) still could not be removed after ${MAX_CLEANUP_ATTEMPTS} tries`);
  return { removed, failed, gaveUp };
}
