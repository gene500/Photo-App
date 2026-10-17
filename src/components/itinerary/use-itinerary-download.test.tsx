// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/itinerary-download", () => ({ saveBlob: vi.fn() }));

import { saveBlob } from "@/lib/itinerary-download";
import { useItineraryDownload } from "./use-itinerary-download";

const result = { blob: new Blob(["x"]), fileName: "t.pdf" };

describe("useItineraryDownload", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is busy while pending, saves on success, then idle", async () => {
    let finish!: (v: typeof result) => void;
    const make = vi.fn(() => new Promise<typeof result>((r) => { finish = r; }));
    const { result: hook } = renderHook(() => useItineraryDownload());
    let p!: Promise<void>;
    act(() => { p = hook.current.run(make); });
    expect(hook.current.busy).toBe(true);
    await act(async () => { finish(result); await p; });
    expect(hook.current.busy).toBe(false);
    expect(hook.current.error).toBeNull();
    expect(saveBlob).toHaveBeenCalledWith(result.blob, "t.pdf");
  });

  it("reports a failure and logs it", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result: hook } = renderHook(() => useItineraryDownload());
    await act(async () => { await hook.current.run(() => Promise.reject(new Error("bad"))); });
    expect(hook.current.error).toBe("Could not create the PDF. Try again.");
    expect(hook.current.busy).toBe(false);
    expect(spy).toHaveBeenCalled();
  });

  it("runs make once for two synchronous calls", async () => {
    const make = vi.fn(async () => result);
    const { result: hook } = renderHook(() => useItineraryDownload());
    await act(async () => { await Promise.all([hook.current.run(make), hook.current.run(make)]); });
    expect(make).toHaveBeenCalledTimes(1);
  });
});
