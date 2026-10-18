// @vitest-environment jsdom
import { useEffect } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/itinerary-download", () => ({ saveBlob: vi.fn() }));

import { saveBlob } from "@/lib/itinerary-download";
import { DownloadDialog } from "./DownloadDialog";
import { useItineraryDownload } from "./use-itinerary-download";

let api!: ReturnType<typeof useItineraryDownload>;
function Harness() {
  const hook = useItineraryDownload();
  useEffect(() => {
    api = hook;
  });
  return (
    <>
      <button type="button">Opener</button>
      <DownloadDialog download={hook} />
    </>
  );
}
const result = { blob: new Blob(["x"]), fileName: "t.pdf" };

describe("DownloadDialog", () => {
  afterEach(() => vi.clearAllMocks());

  it("renders nothing while idle", () => {
    render(<Harness />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("is busy and says so while preparing", () => {
    render(<Harness />);
    act(() => api.prepare(() => new Promise(() => {})));
    const dialog = screen.getByRole("alertdialog", { name: "Itinerary PDF" });
    expect(dialog.getAttribute("aria-busy")).toBe("true");
    expect(dialog.textContent).toContain("Preparing your PDF…");
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
  });

  it("focuses Download when ready, and saves synchronously inside the click", async () => {
    render(<Harness />);
    await act(async () => api.prepare(async () => result));
    const dl = screen.getByRole("button", { name: "Download" });
    expect(document.activeElement).toBe(dl);
    expect(screen.getByRole("alertdialog").textContent).toContain("Your PDF is ready.");
    await userEvent.click(dl);
    expect(saveBlob).toHaveBeenCalledTimes(1); // no waitFor: the save is not deferred
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("Escape cancels, and a ready PDF is not saved", async () => {
    render(<Harness />);
    await act(async () => api.prepare(async () => result));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it("Escape closes only the dialog, not a listener on the document underneath", async () => {
    const under = vi.fn();
    document.addEventListener("keydown", under);
    render(<Harness />);
    await act(async () => api.prepare(async () => result));
    await userEvent.keyboard("{Escape}");
    document.removeEventListener("keydown", under);
    expect(under).not.toHaveBeenCalled();
  });

  it("shows the error with Try again and Close", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Harness />);
    const make = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce(result);
    await act(async () => api.prepare(make));
    expect(screen.getByRole("alertdialog").textContent).toContain("Could not create the PDF. Try again.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(make).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
  });

  it("Close dismisses the error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Harness />);
    await act(async () => api.prepare(() => Promise.reject(new Error("x"))));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("moves focus to Try again on error, back to Cancel on retry, and announces the error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Harness />);
    let release!: (r: typeof result) => void;
    const make = vi.fn().mockRejectedValueOnce(new Error("x")).mockImplementationOnce(() => new Promise((r) => { release = r; }));
    await act(async () => api.prepare(make));
    expect(screen.getByRole("alert").textContent).toBe("Could not create the PDF. Try again.");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Try again" }));
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => release(result));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Download" }));
  });
});
