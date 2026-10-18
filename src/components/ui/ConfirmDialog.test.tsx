// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { type ConfirmOptions, useConfirm } from "./ConfirmDialog";

const opts: ConfirmOptions = { title: "Delete trip?", message: 'Delete "Yosemite"? This cannot be undone.', confirmLabel: "Delete" };

let results: boolean[] = [];
let ask!: (o?: ConfirmOptions) => Promise<boolean>;

function Harness() {
  const { confirm, dialog } = useConfirm();
  useEffect(() => {
    ask = (o = opts) => confirm(o).then((r) => { results.push(r); return r; });
  });
  return (
    <>
      <button type="button" onClick={() => void ask()}>Open</button>
      {dialog}
    </>
  );
}

afterEach(() => {
  cleanup();
  results = [];
});

describe("useConfirm", () => {
  it("opens an alertdialog named by its title and described by its message", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete trip?" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const described = document.getElementById(dialog.getAttribute("aria-describedby")!);
    expect(described?.textContent).toContain("This cannot be undone.");
  });

  it("focuses Cancel first and keeps Tab inside", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const del = screen.getByRole("button", { name: "Delete" });
    expect(document.activeElement).toBe(cancel);
    await userEvent.tab();
    expect(document.activeElement).toBe(del);
    await userEvent.tab();
    expect(document.activeElement).toBe(cancel);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(del);
  });

  it("resolves true on Delete, false on Cancel, Escape and backdrop", async () => {
    render(<Harness />);
    const open = () => userEvent.click(screen.getByRole("button", { name: "Open" }));

    await open();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(results).toEqual([true]);
    expect(screen.queryByRole("alertdialog")).toBeNull();

    await open();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(results).toEqual([true, false]);
    expect(screen.queryByRole("alertdialog")).toBeNull();

    await open();
    await userEvent.keyboard("{Escape}");
    expect(results).toEqual([true, false, false]);
    expect(screen.queryByRole("alertdialog")).toBeNull();

    await open();
    await userEvent.click(screen.getByTestId("dialog-backdrop"));
    expect(results).toEqual([true, false, false, false]);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("does not cancel when the press starts inside the card", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await userEvent.click(screen.getByRole("alertdialog"));
    expect(results).toEqual([]);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("returns focus to the opener", async () => {
    render(<Harness />);
    const open = screen.getByRole("button", { name: "Open" });
    await userEvent.click(open);
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(open);
  });

  it("a second confirm while one is open resolves the first as false", async () => {
    render(<Harness />);
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    await act(async () => { first = ask(); });
    await act(async () => { second = ask(); });
    expect(await first).toBe(false);
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await second).toBe(true);
  });

  it("styles Delete as danger and the card with the app card", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("button", { name: "Delete" }).className).toContain("bg-danger");
    const card = screen.getByRole("alertdialog");
    expect(card.className).toContain("rounded-2xl");
    expect(card.className).toContain("bg-surface");
  });
});
