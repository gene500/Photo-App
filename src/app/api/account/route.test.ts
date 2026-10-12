import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/server/users", () => ({ deleteAccount: vi.fn() }));
vi.mock("@/server/photos", () => ({ deletePhotoFile: vi.fn(async () => true) }));
import { getCurrentUserId } from "@/server/session";
import { deleteAccount } from "@/server/users";
import { deletePhotoFile } from "@/server/photos";
import { DELETE } from "./route";

const del = (body: unknown) =>
  new Request("http://localhost/api/account", { method: "DELETE", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: JSON.stringify(body) });

describe("DELETE /api/account", () => {
  beforeEach(() => vi.mocked(getCurrentUserId).mockResolvedValue("u1"));
  afterEach(() => vi.clearAllMocks());

  it("requires sign-in", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(null);
    expect((await DELETE(del({ password: "x" }))).status).toBe(401);
    expect(deleteAccount).not.toHaveBeenCalled();
  });
  it("needs a password", async () => {
    expect((await DELETE(del({}))).status).toBe(400);
    expect(deleteAccount).not.toHaveBeenCalled();
  });
  it("refuses a wrong password", async () => {
    vi.mocked(deleteAccount).mockResolvedValue(null);
    expect((await DELETE(del({ password: "nope" }))).status).toBe(403);
    expect(deletePhotoFile).not.toHaveBeenCalled();
  });
  it("deletes the account and its photo files", async () => {
    vi.mocked(deleteAccount).mockResolvedValue({ photoUrls: ["/api/uploads/a.jpg", "/api/uploads/b.jpg"] });
    expect((await DELETE(del({ password: "right" }))).status).toBe(204);
    expect(deleteAccount).toHaveBeenCalledWith("u1", "right");
    expect(deletePhotoFile).toHaveBeenCalledTimes(2);
  });
});
