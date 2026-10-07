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
  notes: null, source: "suggested", photoUrl: null, visited: false,
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
    expect(onSave).toHaveBeenCalledWith({ name: "Tunnel View", notes: null, visited: true });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows save errors and stays open", async () => {
    const onClose = vi.fn();
    render(<StopDrawer stop={stop} onClose={onClose} onSave={vi.fn(async () => { throw new Error("Stop not found"); })} onPhotoChange={vi.fn()} />);
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
