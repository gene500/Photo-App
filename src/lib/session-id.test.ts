import { afterEach, describe, expect, it, vi } from "vitest";
import { newSessionId } from "./session-id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newSessionId", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("makes a v4 uuid", () => {
    expect(newSessionId()).toMatch(UUID);
  });
  it("falls back to getRandomValues, then Math.random, never throwing", () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    expect(newSessionId()).toMatch(UUID);
    vi.stubGlobal("crypto", undefined);
    expect(newSessionId()).toMatch(UUID);
  });
});
