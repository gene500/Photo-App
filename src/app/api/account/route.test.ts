import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn(), getAuthTime: vi.fn() }));
vi.mock("@/server/users", () => ({ deleteAccount: vi.fn(), REAUTH_REQUIRED: "reauth-required", ACCOUNT_GONE: "account-gone" }));
vi.mock("@/server/photos", () => ({ deletePhotoFile: vi.fn(async () => true) }));
import { getAuthTime, getCurrentUserId } from "@/server/session";
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
  it("answers 204, like the first delete, when the account was already deleted by a concurrent request", async () => {
    vi.mocked(deleteAccount).mockResolvedValue("account-gone" as never);
    expect((await DELETE(del({ password: "x" }))).status).toBe(204);
    expect(deletePhotoFile).not.toHaveBeenCalled();
  });
  it("tells a stale Google session to sign in again", async () => {
    vi.mocked(deleteAccount).mockResolvedValue("reauth-required" as never);
    const res = await DELETE(del({ confirmEmail: "a@b.com" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Please sign in again to delete your account", reason: "reauth" });
    expect(deletePhotoFile).not.toHaveBeenCalled();
  });
  it("passes the sign-in time to the check", async () => {
    vi.mocked(getAuthTime).mockResolvedValue(1234);
    vi.mocked(deleteAccount).mockResolvedValue({ photoUrls: [] });
    await DELETE(del({ confirmEmail: "a@b.com" }));
    expect(deleteAccount).toHaveBeenCalledWith("u1", { confirmEmail: "a@b.com", authTime: 1234 });
  });
  it("deletes the account and its photo files", async () => {
    vi.mocked(deleteAccount).mockResolvedValue({ photoUrls: ["/api/uploads/a.jpg", "/api/uploads/b.jpg"] });
    expect((await DELETE(del({ password: "right" }))).status).toBe(204);
    expect(deleteAccount).toHaveBeenCalledWith("u1", expect.objectContaining({ password: "right" }));
    expect(deletePhotoFile).toHaveBeenCalledTimes(2);
  });
});
