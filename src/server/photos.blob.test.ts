import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, Uint8Array>();
vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (pathname: string, body: Uint8Array) => {
    store.set(pathname, body);
    return { pathname };
  }),
  get: vi.fn(async (pathname: string) => {
    const bytes = store.get(pathname);
    return bytes ? { stream: new Response(Buffer.from(bytes)).body } : null;
  }),
  del: vi.fn(async (pathname: string) => {
    store.delete(pathname);
  }),
}));

import { deletePhotoFile, isValidPhotoName, PHOTO_URL_PREFIX, readPhoto, savePhoto } from "./photos";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("photos in Vercel Blob mode", () => {
  beforeEach(() => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-token");
    store.clear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("saves, reads back, and deletes a photo through Blob", async () => {
    const url = await savePhoto(PNG_BYTES, "image/png");
    expect(url.startsWith(PHOTO_URL_PREFIX)).toBe(true);
    const name = url.slice(PHOTO_URL_PREFIX.length);
    expect(isValidPhotoName(name)).toBe(true);
    expect(store.has(`photos/${name}`)).toBe(true);

    const read = await readPhoto(name);
    expect(read!.contentType).toBe("image/png");
    expect(new Uint8Array(read!.bytes)).toEqual(PNG_BYTES);

    await deletePhotoFile(url);
    expect(store.size).toBe(0);
    expect(await readPhoto(name)).toBeNull();
  });
});
