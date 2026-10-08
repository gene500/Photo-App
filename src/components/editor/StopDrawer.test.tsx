// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({ api: { uploadPhoto: vi.fn(), removePhoto: vi.fn() } }));
import { api } from "@/lib/api-client";
import { MAX_PHOTO_BYTES } from "@/lib/photo-rules";
import type { Stop } from "@/lib/types";
import { StopDrawer } from "./StopDrawer";

const stop: Stop = {
  id: "s1", tripId: "t1", order: 0, name: "Tunnel View", lat: 37.7156, lng: -119.6773,
  notes: null, source: "suggested", photoUrl: null, visited: false, lightPref: "any", dwellMinutes: 30, shotNotes: null, shotChecklist: [],
};

describe("StopDrawer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves edits (blank notes become null) and closes", async () => {
    const onSave = vi.fn(async () => {});
    const onClose = vi.fn();
    render(<StopDrawer stop={stop} onClose={onClose} onSave={onSave} onPhotoChange={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Notes"), "   ");
    await userEvent.click(screen.getByLabelText("Visited"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    // notes stayed blank (null), so only the visited change is sent
    expect(onSave).toHaveBeenCalledWith({ visited: true });
    expect(onClose).toHaveBeenCalled();
  });

  it("sends only the fields changed in the drawer, so a Visited tick made elsewhere is not undone", async () => {
    const onSave = vi.fn(async () => {});
    const { rerender } = render(<StopDrawer stop={stop} onClose={vi.fn()} onSave={onSave} onPhotoChange={vi.fn()} />);
    rerender(<StopDrawer stop={{ ...stop, visited: true }} onClose={vi.fn()} onSave={onSave} onPhotoChange={vi.fn()} />); // ticked in the list
    await userEvent.type(screen.getByLabelText("Notes"), "Golden light at 7");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ notes: "Golden light at 7" });
  });

  it("saves a changed best light and time here", async () => {
    const onSave = vi.fn(async () => {});
    render(<StopDrawer stop={stop} onClose={vi.fn()} onSave={onSave} onPhotoChange={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText("Best light"), "sunset");
    const dwell = screen.getByLabelText("Time here (min)");
    await userEvent.clear(dwell);
    await userEvent.type(dwell, "75");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ lightPref: "sunset", dwellMinutes: 75 });
  });

  it("rejects a time here outside 0 to 480 minutes", async () => {
    const onSave = vi.fn(async () => {});
    render(<StopDrawer stop={stop} onClose={vi.fn()} onSave={onSave} onPhotoChange={vi.fn()} />);
    const dwell = screen.getByLabelText("Time here (min)");
    await userEvent.clear(dwell);
    await userEvent.type(dwell, "500");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
    expect((await screen.findByRole("alert")).textContent).toContain("0 to 480");
  });

  it("adds checklist items with Enter, ticks and deletes them, and saves the whole list", async () => {
    const onSave = vi.fn(async () => {});
    render(<StopDrawer stop={stop} onClose={vi.fn()} onSave={onSave} onPhotoChange={vi.fn()} />);
    const add = screen.getByLabelText("Add a shot");
    await userEvent.type(add, "Wide from the rail{Enter}");
    await userEvent.type(add, "Detail of bark{Enter}");
    await userEvent.type(add, "Oops{Enter}");
    expect((add as HTMLInputElement).value).toBe("");
    await userEvent.click(screen.getByLabelText("Wide from the rail"));
    await userEvent.click(screen.getByRole("button", { name: "Delete shot Oops" }));
    await userEvent.type(screen.getByLabelText("Shot notes"), "Bring tripod");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({
      shotNotes: "Bring tripod",
      shotChecklist: [{ text: "Wide from the rail", done: true }, { text: "Detail of bark", done: false }],
    });
  });

  it("keeps a typed but unconfirmed shot on save and ignores blank ones", async () => {
    const onSave = vi.fn(async () => {});
    const { unmount } = render(<StopDrawer stop={stop} onClose={vi.fn()} onSave={onSave} onPhotoChange={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Add a shot"), "Last light");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ shotChecklist: [{ text: "Last light", done: false }] });
    unmount();
    onSave.mockClear();
    render(<StopDrawer stop={stop} onClose={vi.fn()} onSave={onSave} onPhotoChange={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Add a shot"), "   {Enter}");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows existing shots and sends nothing when they are untouched", async () => {
    const onSave = vi.fn(async () => {});
    const withShots = { ...stop, shotNotes: "Golden hour", shotChecklist: [{ text: "Silhouette", done: true }] };
    render(<StopDrawer stop={withShots} onClose={vi.fn()} onSave={onSave} onPhotoChange={vi.fn()} />);
    expect((screen.getByLabelText("Silhouette") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Shot notes") as HTMLTextAreaElement).value).toBe("Golden hour");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("stops accepting shots at 20", async () => {
    const full = { ...stop, shotChecklist: Array.from({ length: 20 }, (_, i) => ({ text: `s${i}`, done: false })) };
    render(<StopDrawer stop={full} onClose={vi.fn()} onSave={vi.fn()} onPhotoChange={vi.fn()} />);
    expect((screen.getByLabelText("Add a shot") as HTMLInputElement).disabled).toBe(true);
  });

  it("labels an existing photo as the reference photo", () => {
    render(<StopDrawer stop={{ ...stop, photoUrl: "/api/uploads/x.png" }} onClose={vi.fn()} onSave={vi.fn()} onPhotoChange={vi.fn()} />);
    expect(screen.getByText("Reference photo")).toBeTruthy();
    expect(screen.getByAltText("Reference for Tunnel View")).toBeTruthy();
  });

  it("closes without saving when nothing changed", async () => {
    const onSave = vi.fn(async () => {});
    const onClose = vi.fn();
    render(<StopDrawer stop={stop} onClose={onClose} onSave={onSave} onPhotoChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("shows save errors and stays open", async () => {
    const onClose = vi.fn();
    render(<StopDrawer stop={stop} onClose={onClose} onSave={vi.fn(async () => { throw new Error("Stop not found"); })} onPhotoChange={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Name"), "!");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Stop not found");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("rejects an oversized photo before uploading", async () => {
    render(<StopDrawer stop={stop} onClose={vi.fn()} onSave={vi.fn()} onPhotoChange={vi.fn()} />);
    const big = new File([new Uint8Array(MAX_PHOTO_BYTES + 1)], "big.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Upload photo"), big);
    expect((await screen.findByRole("alert")).textContent).toContain("Photo must be 4 MB or smaller");
    expect(api.uploadPhoto).not.toHaveBeenCalled();
  });

  it("rejects a non-image type before uploading", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<StopDrawer stop={stop} onClose={vi.fn()} onSave={vi.fn()} onPhotoChange={vi.fn()} />);
    await user.upload(screen.getByLabelText("Upload photo"), new File(["x"], "a.txt", { type: "text/plain" }));
    expect((await screen.findByRole("alert")).textContent).toContain("JPEG, PNG, or WebP");
  });

  it("uploads a valid photo and reports the updated stop", async () => {
    const updated = { ...stop, photoUrl: "/api/uploads/x.png" };
    vi.mocked(api.uploadPhoto).mockResolvedValue({ stop: updated });
    const onPhotoChange = vi.fn();
    render(<StopDrawer stop={stop} onClose={vi.fn()} onSave={vi.fn()} onPhotoChange={onPhotoChange} />);
    const file = new File([new Uint8Array([0x89, 0x50])], "a.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Upload photo"), file);
    expect(api.uploadPhoto).toHaveBeenCalledWith("s1", file);
    expect(onPhotoChange).toHaveBeenCalledWith(updated);
  });
});
