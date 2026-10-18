// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/itinerary-download", () => ({ saveBlob: vi.fn() }));

import { saveBlob } from "@/lib/itinerary-download";
import { useItineraryDownload } from "./use-itinerary-download";

const result = { blob: new Blob(["x"]), fileName: "t.pdf" };

describe("useItineraryDownload", () => {
  afterEach(() => vi.clearAllMocks());

  it("goes preparing → ready and saves only on save()", async () => {
    let finish!: (v: typeof result) => void;
    const make = vi.fn(() => new Promise<typeof result>((r) => { finish = r; }));
    const { result: hook } = renderHook(() => useItineraryDownload());
    act(() => hook.current.prepare(make));
    expect(hook.current.state.status).toBe("preparing");
    await act(async () => finish(result));
    expect(hook.current.state).toEqual({ status: "ready", ...result });
    expect(saveBlob).not.toHaveBeenCalled();
    act(() => hook.current.save());
    expect(saveBlob).toHaveBeenCalledTimes(1);
    expect(saveBlob).toHaveBeenCalledWith(result.blob, "t.pdf");
    expect(hook.current.state.status).toBe("idle");
  });

  it("cancel during prepare drops the result", async () => {
    let finish!: (v: typeof result) => void;
    const { result: hook } = renderHook(() => useItineraryDownload());
    act(() => hook.current.prepare(() => new Promise<typeof result>((r) => { finish = r; })));
    act(() => hook.current.cancel());
    await act(async () => finish(result));
    expect(hook.current.state.status).toBe("idle");
    act(() => hook.current.save());
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it("a late failure after cancel stays idle", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let fail!: (e: Error) => void;
    const { result: hook } = renderHook(() => useItineraryDownload());
    act(() => hook.current.prepare(() => new Promise<typeof result>((_r, rej) => { fail = rej; })));
    act(() => hook.current.cancel());
    await act(async () => fail(new Error("late")));
    expect(hook.current.state.status).toBe("idle");
  });

  it("reports an error and can retry", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const make = vi.fn().mockRejectedValueOnce(new Error("bad")).mockResolvedValueOnce(result);
    const { result: hook } = renderHook(() => useItineraryDownload());
    await act(async () => hook.current.prepare(make));
    expect(hook.current.state).toEqual({ status: "error", message: "Could not create the PDF. Try again." });
    expect(spy).toHaveBeenCalled();
    await act(async () => hook.current.retry());
    expect(make).toHaveBeenCalledTimes(2);
    expect(hook.current.state.status).toBe("ready");
  });

  it("ignores a second prepare while preparing", async () => {
    const make = vi.fn(async () => result);
    const { result: hook } = renderHook(() => useItineraryDownload());
    await act(async () => { hook.current.prepare(make); hook.current.prepare(make); });
    expect(make).toHaveBeenCalledTimes(1);
  });
});
