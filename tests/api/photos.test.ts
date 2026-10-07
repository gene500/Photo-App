import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
// Pass-through, so one test can delete the stop while a photo is being saved.
vi.mock("@/server/photos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/photos")>();
  return { ...actual, savePhoto: vi.fn(actual.savePhoto), deletePhotoFile: vi.fn(actual.deletePhotoFile) };
});
import { deletePhotoFile, savePhoto } from "@/server/photos";
import { getCurrentUserId } from "@/server/session";
import { DELETE as photoDELETE, POST as photoPOST } from "@/app/api/stops/[id]/photo/route";
import { DELETE as stopDELETE } from "@/app/api/stops/[id]/route";
import { GET as uploadGET } from "@/app/api/uploads/[name]/route";
import { prisma } from "@/server/db";
import { addStop, deleteStop, getOwnedStop } from "@/server/stops";
import { createTrip } from "@/server/trips";
import { MAX_PHOTO_BYTES } from "@/lib/photo-rules";
import { createTestUser, resetDb, sampleTripInput } from "../helpers/db";
import { idParams } from "../helpers/requests";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const signInAs = (id: string | null) => vi.mocked(getCurrentUserId).mockResolvedValue(id);
const fileOnDisk = (photoUrl: string) => existsSync(path.join(process.env.UPLOAD_DIR!, path.basename(photoUrl)));

function upload(stopId: string, file: File) {
  const form = new FormData();
  form.append("photo", file);
  return photoPOST(new Request(`http://localhost/api/stops/${stopId}/photo`, { method: "POST", body: form }), idParams(stopId));
}

let userId: string;
let stopId: string;

describe("photo routes", () => {
  beforeEach(async () => {
    await resetDb();
    userId = (await createTestUser()).id;
    const trip = await createTrip(userId, sampleTripInput);
    stopId = (await addStop(userId, trip.id, { name: "a", lat: 37, lng: -119, source: "manual" }))!.id;
    signInAs(userId);
  });
  afterEach(() => rmSync(process.env.UPLOAD_DIR!, { recursive: true, force: true }));

  it("uploads a PNG and serves it back to the owner only", async () => {
    const res = await upload(stopId, new File([PNG], "ref.png", { type: "image/png" }));
    expect(res.status).toBe(200);
    const { stop } = await res.json();
    expect(stop.photoUrl).toMatch(/^\/api\/uploads\/[0-9a-f-]{36}\.png$/);

    const name = path.basename(stop.photoUrl);
    const served = await uploadGET(new Request(`http://localhost${stop.photoUrl}`), idParams(name, "name"));
    expect(served.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG);

    signInAs((await createTestUser()).id);
    const denied = await uploadGET(new Request(`http://localhost${stop.photoUrl}`), idParams(name, "name"));
    expect(denied.status).toBe(404);
  });

  it("rejects a non-image with a clear message", async () => {
    const res = await upload(stopId, new File(["hello"], "notes.txt", { type: "text/plain" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Photo must be a JPEG, PNG, or WebP image" });
  });

  it("rejects an oversized image", async () => {
    const big = new Uint8Array(MAX_PHOTO_BYTES + 1);
    big.set(PNG);
    const res = await upload(stopId, new File([big], "big.png", { type: "image/png" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Photo must be 4 MB or smaller");
  });

  it("replaces an existing photo and deletes the old file", async () => {
    const first = (await (await upload(stopId, new File([PNG], "a.png", { type: "image/png" }))).json()).stop.photoUrl;
    const second = (await (await upload(stopId, new File([PNG], "b.png", { type: "image/png" }))).json()).stop.photoUrl;
    expect(second).not.toBe(first);
    expect(fileOnDisk(first)).toBe(false);
    expect(fileOnDisk(second)).toBe(true);
  });

  it("removes a photo via DELETE", async () => {
    const url = (await (await upload(stopId, new File([PNG], "a.png", { type: "image/png" }))).json()).stop.photoUrl;
    const res = await photoDELETE(new Request("http://localhost", { method: "DELETE" }), idParams(stopId));
    expect((await res.json()).stop.photoUrl).toBeNull();
    expect(fileOnDisk(url)).toBe(false);
  });

  it("deleting the stop deletes its photo file", async () => {
    const url = (await (await upload(stopId, new File([PNG], "a.png", { type: "image/png" }))).json()).stop.photoUrl;
    await stopDELETE(new Request("http://localhost", { method: "DELETE" }), idParams(stopId));
    expect(fileOnDisk(url)).toBe(false);
  });

  // Policy: the loser of a concurrent swap deletes its own saved file and gets 200 with the CURRENT stop.
  it("two interleaved uploads leave exactly one new file referenced and delete the old one once", async () => {
    const oldUrl = (await (await upload(stopId, new File([PNG], "old.png", { type: "image/png" }))).json()).stop.photoUrl;
    const real = (await vi.importActual<typeof import("@/server/photos")>("@/server/photos")).savePhoto;
    // Hold both saves until both requests have read the same old photoUrl.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let waiting = 0;
    const saved: string[] = [];
    vi.mocked(savePhoto).mockImplementation(async (...args) => {
      if (++waiting === 2) release();
      await gate;
      const url = await real(...args);
      saved.push(url);
      return url;
    });
    const deleteSpy = vi.mocked(deletePhotoFile);
    deleteSpy.mockClear();

    const [a, b] = await Promise.all([
      upload(stopId, new File([PNG], "a.png", { type: "image/png" })),
      upload(stopId, new File([PNG], "b.png", { type: "image/png" })),
    ]);
    vi.mocked(savePhoto).mockImplementation(real);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(saved).toHaveLength(2);

    const current = (await getOwnedStop(userId, stopId))!.photoUrl!;
    expect(saved).toContain(current);
    const loser = saved.find((u) => u !== current)!;
    // Both responses report the stop's current photo.
    expect((await a.json()).stop.photoUrl).toBe(current);
    expect((await b.json()).stop.photoUrl).toBe(current);
    expect(fileOnDisk(current)).toBe(true);
    expect(fileOnDisk(loser)).toBe(false);
    expect(fileOnDisk(oldUrl)).toBe(false);
    expect(deleteSpy.mock.calls.filter(([u]) => u === oldUrl)).toHaveLength(1);
    expect(deleteSpy.mock.calls.filter(([u]) => u === loser)).toHaveLength(1);
  });

  it("returns 404 and removes the saved file when the stop is deleted mid-upload", async () => {
    let savedUrl = "";
    const real = (await vi.importActual<typeof import("@/server/photos")>("@/server/photos")).savePhoto;
    vi.mocked(savePhoto).mockImplementationOnce(async (...args) => {
      await deleteStop(userId, stopId); // the stop vanishes after the ownership check
      savedUrl = await real(...args);
      return savedUrl;
    });
    const res = await upload(stopId, new File([PNG], "ref.png", { type: "image/png" }));
    expect(res.status).toBe(404);
    expect(savedUrl).not.toBe("");
    expect(fileOnDisk(savedUrl)).toBe(false);
  });
  it("still deletes the old file when the stop is deleted right after a won swap", async () => {
    const oldUrl = (await (await upload(stopId, new File([PNG], "old.png", { type: "image/png" }))).json()).stop.photoUrl;
    const realUpdateMany = prisma.stop.updateMany.bind(prisma.stop);
    const spy = vi.spyOn(prisma.stop, "updateMany").mockImplementationOnce(((args: Parameters<typeof realUpdateMany>[0]) =>
      realUpdateMany(args).then(async (r) => {
        await deleteStop(userId, stopId); // stop vanishes between the swap and the re-read
        return r;
      })) as unknown as typeof prisma.stop.updateMany);
    const res = await photoDELETE(new Request("http://x", { method: "DELETE" }), idParams(stopId));
    spy.mockRestore();
    expect(res.status).toBe(404);
    expect(fileOnDisk(oldUrl)).toBe(false);
  });
});
