import { describe, expect, it, vi } from "vitest";
import { fetchOverpass, OVERPASS_ENDPOINTS, OverpassError, OverpassTooHeavyError } from "./overpass";

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
    expect((fetchImpl.mock.calls as unknown[][]).map((c) => c[0])).toEqual(OVERPASS_ENDPOINTS);
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

  it.each([
    'runtime error: Query ran out of memory in "recurse" at line 3 using about 2048 MB of RAM.',
    "runtime error: Query run out of memory using about 2048 MB of RAM.",
    "runtime error: Query exceeded the maximum size of 6000000 bytes",
  ])("with stopOnHeavy, a too-heavy remark (%s) from two mirrors in a row ends the lookup: two queries, then TooHeavy", async (remark) => {
    noSleep.mockClear();
    const fetchImpl = vi.fn(async () => ok({ elements: [], remark }));
    await expect(fetchOverpass("q", { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep, hedgeMs: Infinity, stopOnHeavy: true })).rejects.toBeInstanceOf(OverpassTooHeavyError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((fetchImpl.mock.calls as unknown[][]).map((c) => c[0])).toEqual([OVERPASS_ENDPOINTS[0], OVERPASS_ENDPOINTS[1]]);
    expect(noSleep).not.toHaveBeenCalled();
  });

  const heavyRemark = "runtime error: Query ran out of memory in \"query\" at line 5 using about 2048 MB of RAM.";
  it("with stopOnHeavy, a heavy first mirror and a normal second mirror: the second answer is used", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok({ elements: [], remark: heavyRemark }))
      .mockResolvedValueOnce(ok({ elements: [7] }));
    await expect(fetchOverpass("q", { fetchImpl, sleep: noSleep, hedgeMs: Infinity, stopOnHeavy: true })).resolves.toEqual({ elements: [7] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("with stopOnHeavy, a heavy first mirror and a failing second mirror is a failure, not a too-heavy verdict", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok({ elements: [], remark: heavyRemark }))
      .mockRejectedValue(new Error("network"));
    const err = await fetchOverpass("q", { fetchImpl, sleep: noSleep, hedgeMs: Infinity, stopOnHeavy: true }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OverpassError);
    expect(err).not.toBeInstanceOf(OverpassTooHeavyError);
  });

  it("with stopOnHeavy, a timed-out remark is still a failed mirror", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(ok({ elements: [], remark: "runtime error: Query timed out in \"query\" at line 3 after 26 seconds." }))
      .mockResolvedValueOnce(ok({ elements: [1] }));
    await expect(fetchOverpass("q", { fetchImpl, sleep: noSleep, hedgeMs: Infinity, stopOnHeavy: true })).resolves.toEqual({ elements: [1] });
  });

  it("without stopOnHeavy an out-of-memory remark behaves as before (every mirror tried)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ elements: [], remark: "runtime error: Query ran out of memory" }));
    await expect(fetchOverpass("q", { fetchImpl, sleep: noSleep, hedgeMs: Infinity })).rejects.toBeInstanceOf(OverpassError);
    expect(fetchImpl).toHaveBeenCalledTimes(OVERPASS_ENDPOINTS.length + 1);
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
