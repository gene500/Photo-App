import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn() }));
import { getCurrentUserId } from "@/server/session";
import { DELETE as route } from "@/app/api/account/sessions/route";

const DELETE = route as (r: Request) => Promise<Response>;
import { getSessionVersion } from "@/server/users";
import { createTestUser, resetDb } from "../helpers/db";

describe("DELETE /api/account/sessions", () => {
  beforeEach(resetDb);

  it("bumps the session version for the signed-in user only", async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    vi.mocked(getCurrentUserId).mockResolvedValue(a.id);
    expect((await DELETE(new Request("http://localhost/api/account/sessions", { method: "DELETE" }))).status).toBe(204);
    expect(await getSessionVersion(a.id)).toBe(1);
    expect(await getSessionVersion(b.id)).toBe(0);
  });

  it("is 401 when signed out", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(null);
    expect((await DELETE(new Request("http://localhost/api/account/sessions", { method: "DELETE" }))).status).toBe(401);
  });
});
