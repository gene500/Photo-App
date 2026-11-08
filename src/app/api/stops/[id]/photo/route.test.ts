import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/server/stops", () => ({ getOwnedStop: vi.fn(), swapStopPhoto: vi.fn() }));
vi.mock("@/server/photos", () => ({
  savePhoto: vi.fn(),
  deletePhotoFile: vi.fn(),
  validatePhoto: vi.fn(),
}));
import { getCurrentUserId } from "@/server/session";
import { deletePhotoFile, savePhoto, validatePhoto } from "@/server/photos";
import { getOwnedStop, swapStopPhoto } from "@/server/stops";
import { POST } from "./route";

const post = () => {
  const form = new FormData();
  form.set("photo", new File([new Uint8Array([1, 2, 3])], "a.jpg", { type: "image/jpeg" }));
  return POST(new Request("http://localhost/api/stops/s1/photo", { method: "POST", headers: { Origin: "http://localhost" }, body: form }), { params: Promise.resolve({ id: "s1" }) });
};

describe("POST /api/stops/[id]/photo", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUserId).mockResolvedValue("u-photo-route");
    vi.mocked(getOwnedStop).mockResolvedValue({ id: "s1", photoUrl: "/api/uploads/old.jpg" } as never);
    vi.mocked(validatePhoto).mockReturnValue({ ok: true, bytes: new Uint8Array([1]), type: "image/jpeg" } as never);
    vi.mocked(savePhoto).mockResolvedValue("/api/uploads/new.jpg");
    vi.mocked(deletePhotoFile).mockResolvedValue(true);
  });
  afterEach(() => vi.clearAllMocks());

  it("removes the newly saved file when the database swap throws", async () => {
    vi.mocked(swapStopPhoto).mockRejectedValue(new Error("db down"));
    const res = await post();
    expect(res.status).toBe(500);
    expect(deletePhotoFile).toHaveBeenCalledTimes(1);
    expect(deletePhotoFile).toHaveBeenCalledWith("/api/uploads/new.jpg");
  });

  it("keeps the new file when the swap threw after the database had already committed it", async () => {
    vi.mocked(swapStopPhoto).mockRejectedValue(new Error("reply timeout"));
    vi.mocked(getOwnedStop).mockResolvedValueOnce({ id: "s1", photoUrl: "/api/uploads/old.jpg" } as never).mockResolvedValueOnce({ id: "s1", photoUrl: "/api/uploads/new.jpg" } as never);
    const res = await post();
    expect(res.status).toBe(200);
    expect(deletePhotoFile).not.toHaveBeenCalledWith("/api/uploads/new.jpg");
    expect(deletePhotoFile).toHaveBeenCalledWith("/api/uploads/old.jpg");
  });

  it("keeps the new file (a possible orphan beats a broken photo) when it cannot tell whether the swap committed", async () => {
    vi.mocked(swapStopPhoto).mockRejectedValue(new Error("db down"));
    vi.mocked(getOwnedStop).mockResolvedValueOnce({ id: "s1", photoUrl: "/api/uploads/old.jpg" } as never).mockRejectedValueOnce(new Error("db down"));
    expect((await post()).status).toBe(500);
    expect(deletePhotoFile).not.toHaveBeenCalled();
  });

  it("still fails with the database error when the cleanup also throws", async () => {
    vi.mocked(swapStopPhoto).mockRejectedValue(new Error("db down"));
    vi.mocked(deletePhotoFile).mockRejectedValue(new Error("disk"));
    expect((await post()).status).toBe(500);
  });

  it("deletes the old file after a successful swap", async () => {
    vi.mocked(swapStopPhoto).mockResolvedValue({ status: "swapped", stop: { id: "s1" } } as never);
    expect((await post()).status).toBe(200);
    expect(deletePhotoFile).toHaveBeenCalledWith("/api/uploads/old.jpg");
    expect(deletePhotoFile).not.toHaveBeenCalledWith("/api/uploads/new.jpg");
  });
});
