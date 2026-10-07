// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebouncedValue } from "./use-debounced-value";

describe("useDebouncedValue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("only updates after the value has been stable for the delay", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 250), { initialProps: { v: "a" } });
    rerender({ v: "ab" });
    rerender({ v: "abc" });
    expect(result.current).toBe("a");
    act(() => vi.advanceTimersByTime(249));
    expect(result.current).toBe("a");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe("abc");
  });
});
