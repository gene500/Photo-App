// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
import { isKnownFresh, RefreshWhenStale, WRITE_LANDED_EVENT } from "./RefreshWhenStale";

let stamp = 1_000;
const fresh = () => ++stamp;

describe("RefreshWhenStale", () => {
  beforeEach(() => {
    refresh.mockClear();
    vi.restoreAllMocks();
  });

  it("does not refresh a page the server just rendered, whatever the browser clock says", () => {
    vi.spyOn(Date, "now").mockReturnValue(stamp + 10 * 60_000); // skewed or slow: irrelevant
    render(<RefreshWhenStale renderedAt={fresh()} />);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes once when a stamp this tab already showed comes back (Back/Forward cache)", () => {
    const s = fresh();
    render(<RefreshWhenStale renderedAt={s} />).unmount();
    expect(refresh).not.toHaveBeenCalled();
    const { rerender } = render(<RefreshWhenStale renderedAt={s} />);
    expect(refresh).toHaveBeenCalledTimes(1);
    rerender(<RefreshWhenStale renderedAt={fresh()} />); // the fresh render arrives: no loop
    rerender(<RefreshWhenStale renderedAt={s} />);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh again for the fresh stamp after the refresh", () => {
    const s = fresh();
    render(<RefreshWhenStale renderedAt={s} />).unmount();
    const { rerender } = render(<RefreshWhenStale renderedAt={s} />);
    rerender(<RefreshWhenStale renderedAt={fresh()} />);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes a document the browser reloaded from history", () => {
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([{ type: "back_forward" } as PerformanceNavigationTiming]);
    render(<RefreshWhenStale renderedAt={fresh()} />);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes when a write lands after the editor was left, and reports which stamps are known fresh", () => {
    const s = fresh();
    render(<RefreshWhenStale renderedAt={s} />);
    expect(isKnownFresh(s)).toBe(true);
    window.dispatchEvent(new Event(WRITE_LANDED_EVENT));
    expect(refresh).toHaveBeenCalledTimes(1);
    render(<RefreshWhenStale renderedAt={s} />); // the same stamp shown again is a cached copy
    expect(isKnownFresh(s)).toBe(false);
  });
});
