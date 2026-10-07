// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { StopsPanel } from "./StopsPanel";

function panel() {
  return render(
    <StopsPanel
      header={<h1>Sierra loop <button type="button">Edit trip</button></h1>}
      collapsedSummary="3 stops · 2 h 5 min"
      summary={<p>100 km</p>}
      stops={<p>stops content</p>}
      suggestions={<p>suggestions content</p>}
      suggestionCount={3}
    />,
  );
}

describe("StopsPanel", () => {
  it("shows the header, summary and the Stops tab by default", () => {
    panel();
    expect(screen.getByRole("heading", { name: /Sierra loop/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit trip" })).toBeTruthy();
    expect(screen.getByText("100 km")).toBeTruthy();
    expect(screen.getByText("stops content")).toBeTruthy();
    expect(screen.queryByText("suggestions content")).toBeNull();
    expect(screen.getByRole("tab", { name: "Stops" }).getAttribute("aria-selected")).toBe("true");
  });

  it("switches to the Suggestions tab and shows the count", async () => {
    panel();
    await userEvent.click(screen.getByRole("tab", { name: "Suggestions (3)" }));
    expect(screen.getByText("suggestions content")).toBeTruthy();
    expect(screen.queryByText("stops content")).toBeNull();
  });

  it("cycles the sheet height and hides the content when collapsed", async () => {
    panel();
    const handle = screen.getByRole("button", { name: "Resize panel" });
    const root = handle.closest("[data-snap]")!;
    expect(root.getAttribute("data-snap")).toBe("half");
    await userEvent.click(handle);
    expect(root.getAttribute("data-snap")).toBe("full");
    await userEvent.click(handle);
    expect(root.getAttribute("data-snap")).toBe("collapsed");
    expect(screen.queryByText("stops content")).toBeNull();
    // Collapsed shows a one-line summary instead of the header (and its Edit trip button).
    expect(screen.getByText("3 stops · 2 h 5 min")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Sierra loop/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit trip" })).toBeNull();
    await userEvent.click(handle);
    expect(root.getAttribute("data-snap")).toBe("half");
  });
});
