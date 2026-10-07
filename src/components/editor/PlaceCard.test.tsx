// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlaceCard } from "./PlaceCard";

const loadPlacePhoto = vi.fn();
vi.mock("@/lib/place-photo-cache", () => ({ loadPlacePhoto: (...a: unknown[]) => loadPlacePhoto(...a) }));
const photo = { url: "https://upload.wikimedia.org/a.jpg", title: "Tunnel View", pageUrl: "https://en.wikipedia.org/wiki/X", credit: "Photo: Jane Doe via Flickr (CC BY 2.0)" };
const source = { osmId: "node/1", lat: 37.7, lng: -119.7 };

describe("PlaceCard", () => {
  beforeEach(() => loadPlacePhoto.mockReset());

  it("shows the place name and adds it as a stop", async () => {
    const onAdd = vi.fn();
    render(<PlaceCard name="Tunnel View" resolving={false} busy={false} onAdd={onAdd} onClose={vi.fn()} />);
    expect(screen.getByText("Tunnel View")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Add stop" }));
    expect(onAdd).toHaveBeenCalled();
  });

  it("disables adding while the name is still being looked up or a save is in flight", () => {
    const { rerender } = render(<PlaceCard name="Looking up place…" resolving busy={false} onAdd={vi.fn()} onClose={vi.fn()} />);
    expect((screen.getByRole("button", { name: "Add stop" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<PlaceCard name="Tunnel View" resolving={false} busy onAdd={vi.fn()} onClose={vi.fn()} />);
    expect((screen.getByRole("button", { name: "Add stop" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("closes", async () => {
    const onClose = vi.fn();
    render(<PlaceCard name="X" resolving={false} busy={false} onAdd={vi.fn()} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the photo of a suggested place next to its name", async () => {
    loadPlacePhoto.mockResolvedValue(photo);
    render(<PlaceCard name="Tunnel View" resolving={false} busy={false} suggestion={source} onAdd={vi.fn()} onClose={vi.fn()} />);
    const img = await screen.findByAltText("Photo of Tunnel View");
    expect(img.getAttribute("src")).toBe(photo.url);
    expect(loadPlacePhoto).toHaveBeenCalledWith({ key: "node/1", name: "Tunnel View", lat: 37.7, lng: -119.7 });
    expect(screen.getByTestId("photo-credit").textContent).toBe("Photo: Jane Doe via Flickr (CC BY 2.0)");
  });

  it("shows no image when there is no photo, the lookup fails, or the image errors", async () => {
    loadPlacePhoto.mockResolvedValue(null);
    const { unmount } = render(<PlaceCard name="Tunnel View" resolving={false} busy={false} suggestion={source} onAdd={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(loadPlacePhoto).toHaveBeenCalled());
    expect(screen.queryByRole("img")).toBeNull();
    unmount();

    loadPlacePhoto.mockResolvedValue(photo);
    render(<PlaceCard name="Tunnel View" resolving={false} busy={false} suggestion={source} onAdd={vi.fn()} onClose={vi.fn()} />);
    (await screen.findByAltText("Photo of Tunnel View")).dispatchEvent(new Event("error"));
    await waitFor(() => expect(screen.queryByRole("img")).toBeNull());
  });

  it("does not look up photos for ordinary (non-suggestion) places", () => {
    render(<PlaceCard name="Alpha Town" resolving={false} busy={false} onAdd={vi.fn()} onClose={vi.fn()} />);
    expect(loadPlacePhoto).not.toHaveBeenCalled();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
