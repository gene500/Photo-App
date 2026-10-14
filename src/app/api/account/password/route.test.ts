import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/server/users", () => ({ changePassword: vi.fn() }));
import { getCurrentUserId } from "@/server/session";
import { changePassword } from "@/server/users";
import { POST } from "./route";

const post = (body: unknown) =>
  new Request("http://localhost/api/account/password", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: JSON.stringify(body) });

describe("POST /api/account/password", () => {
  beforeEach(() => vi.mocked(getCurrentUserId).mockResolvedValue("u1"));
  afterEach(() => vi.clearAllMocks());

  it("requires sign-in", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(null);
    expect((await POST(post({ currentPassword: "a", newPassword: "long-enough-1" }))).status).toBe(401);
    expect(changePassword).not.toHaveBeenCalled();
  });
  it("rejects a short, unchanged or missing password", async () => {
    expect((await POST(post({ currentPassword: "old-password", newPassword: "short" }))).status).toBe(400);
    expect((await POST(post({ currentPassword: "same-password", newPassword: "same-password" }))).status).toBe(400);
    expect((await POST(post({ newPassword: "long-enough-1" }))).status).toBe(400);
    expect(changePassword).not.toHaveBeenCalled();
  });
  it("refuses a wrong current password", async () => {
    vi.mocked(changePassword).mockResolvedValue(false);
    expect((await POST(post({ currentPassword: "nope-nope", newPassword: "long-enough-1" }))).status).toBe(403);
  });
  it("changes the password", async () => {
    vi.mocked(changePassword).mockResolvedValue(true);
    expect((await POST(post({ currentPassword: "old-password", newPassword: "long-enough-1" }))).status).toBe(204);
    expect(changePassword).toHaveBeenCalledWith("u1", "old-password", "long-enough-1");
  });
});
