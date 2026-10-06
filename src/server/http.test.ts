import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("./session", () => ({ getCurrentUserId: vi.fn() }));
import { getCurrentUserId } from "./session";
import { handle, HttpError, readJson, requireUserId } from "./http";

describe("handle", () => {
  it("passes through successful responses", async () => {
    const res = await handle(async () => Response.json({ ok: true }))();
    expect(res.status).toBe(200);
  });

  it("maps HttpError to its status and message", async () => {
    const res = await handle(async () => {
      throw new HttpError(404, "Trip not found");
    })();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Trip not found" });
  });

  it("maps ZodError to 400 with a readable message", async () => {
    const res = await handle(async () => {
      z.object({ name: z.string().min(1, "Name is required") }).parse({ name: "" });
      return Response.json({});
    })();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "name: Name is required" });
  });

  it("hides unexpected errors behind a generic 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handle(async () => {
      throw new Error("SQLITE_BUSY: secret internals");
    })();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Something went wrong" });
  });
});

describe("requireUserId", () => {
  it("returns the signed-in user id", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue("u1");
    await expect(requireUserId()).resolves.toBe("u1");
  });

  it("throws 401 when signed out", async () => {
    vi.mocked(getCurrentUserId).mockResolvedValue(null);
    await expect(requireUserId()).rejects.toMatchObject({ status: 401 });
  });
});

describe("readJson", () => {
  it("throws 400 on a malformed body", async () => {
    const req = new Request("http://localhost/x", { method: "POST", body: "{nope" });
    await expect(readJson(req)).rejects.toMatchObject({ status: 400, message: "Invalid JSON body" });
  });
});
