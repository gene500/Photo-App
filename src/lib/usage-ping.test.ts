import { afterEach, describe, expect, it, vi } from "vitest";
import { sendUsagePing } from "./usage-ping";

afterEach(() => vi.unstubAllGlobals());

describe("sendUsagePing", () => {
  it("posts the kind and is true on 204", async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", f);
    expect(await sendUsagePing("static-map")).toBe(true);
    expect(f.mock.calls[0]![0]).toBe("/api/usage/ping");
    expect(JSON.parse(f.mock.calls[0]![1].body)).toEqual({ kind: "static-map" });
  });

  it("is false on a 429", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 429 })));
    expect(await sendUsagePing("static-map")).toBe(false);
  });

  it("is true when the ping cannot be sent (never blocks on its own failure)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await sendUsagePing("map-load")).toBe(true);
  });
});
