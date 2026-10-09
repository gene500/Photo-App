import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("./session", () => ({ getCurrentUserId: vi.fn() }));
import { getCurrentUserId } from "./session";
import { assertSameOrigin, handle, HttpError, readBodyBytes, readJson, requireUserId } from "./http";

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

describe("readJson size cap", () => {
  it("refuses a declared oversize body with 413 before reading it", async () => {
    const req = new Request("http://localhost/x", { method: "POST", headers: { "content-length": "2000000" }, body: "{}" });
    await expect(readJson(req)).rejects.toMatchObject({ status: 413 });
  });

  it("cuts off a streamed body that exceeds the cap without a content-length", async () => {
    const chunk = new Uint8Array(400_000).fill(32);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent++ < 10) c.enqueue(chunk);
        else c.close();
      },
    });
    const req = new Request("http://localhost/x", { method: "POST", body, duplex: "half" } as RequestInit);
    await expect(readJson(req)).rejects.toMatchObject({ status: 413 });
    expect(sent).toBeLessThan(10);
  });

  it("still parses a normal body, and honours a custom cap", async () => {
    const req = () => new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ a: 1 }) });
    expect(await readJson(req())).toEqual({ a: 1 });
    await expect(readJson(req(), 3)).rejects.toMatchObject({ status: 413 });
    expect((await readBodyBytes(new Request("http://localhost/x", { method: "POST" }), 10)).length).toBe(0);
  });
});

describe("cross-site guard", () => {
  const post = (headers: Record<string, string>, url = "http://localhost:3000/api/x") =>
    new Request(url, { method: "POST", headers, body: "{}" });

  it("refuses a foreign Origin, a null Origin and Sec-Fetch-Site cross-site on state-changing methods", () => {
    expect(() => assertSameOrigin(post({ origin: "https://evil.example" }))).toThrow(HttpError);
    expect(() => assertSameOrigin(post({ origin: "null" }))).toThrow(HttpError);
    expect(() => assertSameOrigin(post({ "sec-fetch-site": "cross-site" }))).toThrow(HttpError);
    expect(() => assertSameOrigin(post({ "sec-fetch-site": "same-site" }))).toThrow(HttpError);
    expect(() => assertSameOrigin(post({ origin: "http://localhost:3001" }))).toThrow(HttpError);
  });

  it("allows same-origin browsers and header-less clients, and never blocks safe methods", () => {
    expect(() => assertSameOrigin(post({ origin: "http://localhost:3000", "sec-fetch-site": "same-origin" }))).not.toThrow();
    expect(() => assertSameOrigin(post({}))).not.toThrow();
    expect(() => assertSameOrigin(new Request("http://localhost/x", { headers: { origin: "https://evil.example" } }))).not.toThrow();
  });

  it("handle() answers 403 for every unsafe method from another origin and does not run the handler", async () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      const fn = vi.fn(async () => Response.json({}));
      const res = await (handle(fn) as (r: Request) => Promise<Response>)(new Request("http://localhost/x", { method, headers: { origin: "https://evil.example" } }));
      expect(res.status).toBe(403);
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("retry-after is sent for 429s", async () => {
    const res = await handle(async () => {
      throw new HttpError(429, "slow down", 42);
    })();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
  });
});
