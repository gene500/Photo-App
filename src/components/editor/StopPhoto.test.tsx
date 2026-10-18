// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPlacePhoto } from "@/lib/place-photo-cache";
import { StopPhoto, stopPhotoKey } from "./StopPhoto";

vi.mock("@/lib/place-photo-cache", () => ({ loadPlacePhoto: vi.fn() }));

const base = { name: "Tunnel View", lat: 37.7456, lng: -119.5972, photoUrl: null };
const photo = (url: string) => ({ url, title: "t", pageUrl: "https://example.com", credit: "c", license: null, source: "wikipedia" }) as never;

beforeEach(() => {
  vi.mocked(loadPlacePhoto).mockReset();
  vi.mocked(loadPlacePhoto).mockResolvedValue(photo("https://upload.wikimedia.org/x.jpg"));
});
afterEach(() => vi.unstubAllGlobals());

describe("StopPhoto", () => {
  it("uses the stop's own upload without a lookup", () => {
    const { container } = render(<StopPhoto stop={{ ...base, photoUrl: "/api/photos/x.jpg" }} />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/api/photos/x.jpg");
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(loadPlacePhoto).not.toHaveBeenCalled();
  });

  it("looks up the place photo by a position+name key", async () => {
    const { container } = render(<StopPhoto stop={base} />);
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    expect(loadPlacePhoto).toHaveBeenCalledTimes(1);
    expect(loadPlacePhoto).toHaveBeenCalledWith({ key: "stop:37.74560,-119.59720:Tunnel View", name: "Tunnel View", lat: 37.7456, lng: -119.5972 });
    expect(stopPhotoKey(base)).toBe("stop:37.74560,-119.59720:Tunnel View");
    expect(container.querySelector("img")!.getAttribute("src")).toBe("https://upload.wikimedia.org/x.jpg");
  });

  it("skips the lookup for a dropped pin named by coordinates or a street address, and keeps the placeholder", () => {
    for (const name of ["37.7456, -119.5972", "1600 Pennsylvania Ave NW"]) {
      const { unmount } = render(<StopPhoto stop={{ ...base, name, source: "manual" }} />);
      expect(screen.getByTestId("stop-photo-placeholder")).toBeTruthy();
      unmount();
    }
    expect(loadPlacePhoto).not.toHaveBeenCalled();
  });

  it("still looks up a suggested stop whose name starts with a number", async () => {
    render(<StopPhoto stop={{ ...base, name: "7 Mile Beach", source: "suggested" }} />);
    await waitFor(() => expect(loadPlacePhoto).toHaveBeenCalledTimes(1));
  });

  it("does not request until visible", () => {
    let fire: (e: Partial<IntersectionObserverEntry>[]) => void = () => {};
    class IO {
      constructor(cb: (e: Partial<IntersectionObserverEntry>[]) => void) { fire = cb; }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", IO);
    render(<StopPhoto stop={base} />);
    expect(loadPlacePhoto).not.toHaveBeenCalled();
    act(() => fire([{ isIntersecting: true }]));
    expect(loadPlacePhoto).toHaveBeenCalledTimes(1);
  });

  it("falls back to the placeholder on null/error", async () => {
    vi.mocked(loadPlacePhoto).mockResolvedValueOnce(null);
    const first = render(<StopPhoto stop={base} />);
    expect(await screen.findByTestId("stop-photo-placeholder")).toBeTruthy();
    first.unmount();

    const { container } = render(<StopPhoto stop={{ ...base, photoUrl: "/api/photos/x.jpg" }} />);
    fireEvent.error(container.querySelector("img")!);
    expect(screen.getByTestId("stop-photo-placeholder")).toBeTruthy();
  });

  it("has rounded corners matching the app's thumbnails", async () => {
    const { container } = render(<StopPhoto stop={base} />);
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    for (const c of ["rounded-xl", "h-10", "w-10", "object-cover"]) expect(container.querySelector("img")!.className).toContain(c);
    vi.mocked(loadPlacePhoto).mockResolvedValue(null);
    const other = render(<StopPhoto stop={{ ...base, name: "Other" }} />);
    const ph = await screen.findByTestId("stop-photo-placeholder");
    for (const c of ["rounded-xl", "h-10", "w-10"]) expect(ph.className).toContain(c);
    other.unmount();
  });

  it("uses only theme tokens", async () => {
    vi.mocked(loadPlacePhoto).mockResolvedValue(null);
    render(<StopPhoto stop={base} />);
    const ph = await screen.findByTestId("stop-photo-placeholder");
    expect(ph.className).toContain("bg-accent-soft");
    expect(ph.className).not.toContain("#");
    const icon = ph.querySelector("svg")!;
    expect(icon.getAttribute("class")).toContain("text-accent-strong");
    expect(icon.getAttribute("class")).not.toContain("#");
  });
});
