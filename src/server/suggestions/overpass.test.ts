import { describe, expect, it, vi } from "vitest";
import { fetchOverpass, OVERPASS_ENDPOINTS, OverpassError } from "./overpass";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const noSleep = vi.fn(async () => {});

describe("fetchOverpass", () => {
  it("POSTs the query form-encoded and returns parsed JSON", async () => {
    const fetchImpl = vi.fn(async () => ok({ elements: [] }));
    await expect(fetchOverpass("[out:json];", { fetchImpl, sleep: noSleep, hedgeMs: Infinity })).resolves.toEqual({ elements: [] });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBe("data=%5Bout%3Ajson%5D%3B");
  });

  it("moves straight on to the next mirror after a 429 or 504, without waiting", async () => {
    noSleep.mockClear();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockResolvedValueOnce(new Response("busy", { status: 504 }))
      .mockResolvedValueOnce(ok({ elements: [1] }));
    await expect(fetchOverpass("q", { fetchImpl, sleep: noSleep, hedgeMs: Infinity })).resolves.toEqual({ elements: [1] });
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual(OVERPASS_ENDPOINTS);
    expect(noSleep).not.toHaveBeenCalled();
  });

  it("after every mirror fails, waits a second and retries the first once, then gives up with OverpassError", async () => {
    noSleep.mockClear();
    const fetchImpl = vi.fn().mockRejectedValue(new Error("The operation was aborted due to timeout"));
    await expect(fetchOverpass("q", { fetchImpl, sleep: noSleep, hedgeMs: Infinity })).rejects.toBeInstanceOf(OverpassError);
    expect(fetchImpl).toHaveBeenCalledTimes(OVERPASS_ENDPOINTS.length + 1);
    expect(noSleep).toHaveBeenCalledWith(1000);
  });

  it("does not retry a 400", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("bad query", { status: 400 }));
    await expect(fetchOverpass("q", { fetchImpl, sleep: noSleep, hedgeMs: Infinity })).rejects.toThrow("Overpass responded 400");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("treats a 200 carrying a runtime-error remark (query timed out, partial or empty elements) as a failed mirror", async () => {
    noSleep.mockClear();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok({ elements: [], remark: "runtime error: Query timed out in \"query\" at line 3 after 26 seconds." }))
      .mockResolvedValueOnce(ok({ elements: [1] }));
    await expect(fetchOverpass("q", { fetchImpl, sleep: noSleep, hedgeMs: Infinity })).resolves.toEqual({ elements: [1] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws OverpassError when every mirror answers with a runtime-error remark", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ elements: [], remark: "runtime error: Query ran out of memory" }));
    await expect(fetchOverpass("q", { fetchImpl, sleep: noSleep, hedgeMs: Infinity })).rejects.toBeInstanceOf(OverpassError);
  });

  it("starts the next mirror when the first has not answered within the hedge delay, and the fastest good answer wins", async () => {
    const fetchImpl = vi.fn((url: string, init?: RequestInit) =>
      url === OVERPASS_ENDPOINTS[0]
        ? new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))
        : Promise.resolve(ok({ elements: [2] })),
    ) as unknown as typeof fetch;
    await expect(fetchOverpass("q", { fetchImpl, sleep: noSleep, hedgeMs: 5 })).resolves.toEqual({ elements: [2] });
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual([OVERPASS_ENDPOINTS[0], OVERPASS_ENDPOINTS[1]]);
  });

  it("does not start a second mirror when the first answers inside the hedge delay", async () => {
    const fetchImpl = vi.fn(async () => ok({ elements: [1] }));
    await expect(fetchOverpass("q", { fetchImpl, sleep: noSleep, hedgeMs: 200 })).resolves.toEqual({ elements: [1] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
