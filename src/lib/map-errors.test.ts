import { describe, expect, it } from "vitest";
import { isMapFatalError } from "./map-errors";

describe("isMapFatalError", () => {
  it("flags a rejected token wherever it comes from", () => {
    expect(isMapFatalError({ error: { status: 401 }, tile: {} })).toBe(true);
    expect(isMapFatalError({ error: { status: 403 }, sourceId: "composite" })).toBe(true);
  });
  it("flags style-level failures: 404, 500, network and abort", () => {
    expect(isMapFatalError({ error: { status: 404 } })).toBe(true);
    expect(isMapFatalError({ error: { status: 500 } })).toBe(true);
    expect(isMapFatalError({ error: { message: "Failed to fetch" } })).toBe(true);
    expect(isMapFatalError({ error: { message: "The operation was aborted" } })).toBe(true);
  });
  it("ignores ordinary tile errors and unrelated messages", () => {
    expect(isMapFatalError({ error: { status: 404 }, tile: {} })).toBe(false);
    expect(isMapFatalError({ error: { status: 500 }, sourceId: "composite" })).toBe(false);
    expect(isMapFatalError({ error: { message: "Image could not be decoded" } })).toBe(false);
    expect(isMapFatalError({})).toBe(false);
  });
});
