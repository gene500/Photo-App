import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./db";
import { deletePhotoFile, MAX_CLEANUP_ATTEMPTS, PHOTO_URL_PREFIX, retryPendingDeletions } from "./photos";
import { resetDb } from "../../tests/helpers/db";

const NAME = "11111111-1111-4111-8111-111111111111.jpg";
const URL_ = `${PHOTO_URL_PREFIX}${NAME}`;

describe("durable photo cleanup", () => {
  beforeEach(resetDb);
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(process.env.UPLOAD_DIR!, { recursive: true, force: true });
  });

  it("queues a photo whose removal failed, then removes it on retry", async () => {
    const dir = process.env.UPLOAD_DIR!;
    mkdirSync(path.join(dir, NAME), { recursive: true }); // a directory, so unlink fails (EISDIR/EPERM)
    expect(await deletePhotoFile(URL_)).toBe(false);
    expect(await prisma.pendingPhotoDeletion.count()).toBe(1);

    const first = await retryPendingDeletions();
    expect(first).toMatchObject({ removed: 0, failed: 1 });
    expect((await prisma.pendingPhotoDeletion.findFirstOrThrow()).attempts).toBe(1);

    rmSync(path.join(dir, NAME), { recursive: true });
    writeFileSync(path.join(dir, NAME), "x");
    expect(await retryPendingDeletions()).toMatchObject({ removed: 1, failed: 0 });
    expect(await prisma.pendingPhotoDeletion.count()).toBe(0);
  });

  it("does not queue a photo that is already gone, and retry is idempotent", async () => {
    expect(await deletePhotoFile(URL_)).toBe(true);
    expect(await prisma.pendingPhotoDeletion.count()).toBe(0);
    await prisma.pendingPhotoDeletion.create({ data: { photoUrl: URL_ } });
    expect(await retryPendingDeletions()).toMatchObject({ removed: 1 });
    expect(await retryPendingDeletions()).toMatchObject({ removed: 0, failed: 0 });
  });

  it("stops retrying after the attempt limit", async () => {
    mkdirSync(path.join(process.env.UPLOAD_DIR!, NAME), { recursive: true });
    await prisma.pendingPhotoDeletion.create({ data: { photoUrl: URL_, attempts: MAX_CLEANUP_ATTEMPTS } });
    const r = await retryPendingDeletions();
    expect(r).toMatchObject({ removed: 0, failed: 0, gaveUp: 1 });
  });

  it("ignores non-photo URLs", async () => {
    expect(await deletePhotoFile("https://example.com/x.jpg")).toBe(true);
    expect(await deletePhotoFile(null)).toBe(true);
    expect(await prisma.pendingPhotoDeletion.count()).toBe(0);
  });
});
