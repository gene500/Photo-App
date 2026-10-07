export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type PhotoType = (typeof PHOTO_TYPES)[number];

/** Shared by the upload input (client) and the upload route (server). */
export function checkPhotoFile(file: { type: string; size: number }): string | null {
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) {
    return "Photo must be a JPEG, PNG, or WebP image";
  }
  if (file.size === 0) return "Photo file is empty";
  if (file.size > MAX_PHOTO_BYTES) return "Photo must be 5 MB or smaller";
  return null;
}
