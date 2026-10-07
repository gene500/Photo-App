import { describe, expect, it, vi } from "vitest";
import { fetchOverpass, OverpassError } from "./overpass";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const noSleep = vi.fn(async () => {});

describe("fetchOverpass", () => {
  it("POSTs the query form-encoded and returns parsed JSON", async () => {
    const fetchImpl = vi.fn(async () => ok({ elements: [] }));
    await expect(fetchOverpass("[out:json];", { fetchImpl, sleep: noSleep })).resolves.toEqual({ elements: [] });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBe("data=%5Bout%3Ajson%5D%3B");
  });

  it("retries once after a 504 and then succeeds", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("busy", { status: 504 }))
      .mockResolvedValueOnce(ok({ elements: [1] }));
    await expect(fetchOverpass("q", { fetchImpl, sleep: noSleep })).resolves.toEqual({ elements: [1] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(noSleep).toHaveBeenCalledWith(1000);
  });

  it("gives up with OverpassError after the retry also fails", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("The operation was aborted due to timeout"));
    await expect(fetchOverpass("q", { fetchImpl, sleep: noSleep })).rejects.toBeInstanceOf(OverpassError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("bad query", { status: 400 }));
    await expect(fetchOverpass("q", { fetchImpl, sleep: noSleep })).rejects.toThrow("Overpass responded 400");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
