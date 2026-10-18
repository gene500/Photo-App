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
      trip={<p>trip content</p>}
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

  it("has Stops, My trip and Suggestions tabs in that order", () => {
    panel();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Stops", "My trip", "Suggestions (3)"]);
  });

  it("shows the trip panel on My trip", async () => {
    panel();
    await userEvent.click(screen.getByRole("tab", { name: "My trip" }));
    expect(screen.getByText("trip content")).toBeTruthy();
    expect(screen.queryByText("stops content")).toBeNull();
    expect(screen.queryByText("suggestions content")).toBeNull();
  });

  it("switches to the Suggestions tab and shows the count", async () => {
    panel();
    await userEvent.click(screen.getByRole("tab", { name: "Suggestions (3)" }));
    expect(screen.getByText("suggestions content")).toBeTruthy();
    expect(screen.queryByText("stops content")).toBeNull();
  });

  it("has one arrow per direction: ▾ always shrinks and ▴ always grows", async () => {
    panel();
    const root = screen.getByRole("button", { name: "Shrink panel" }).closest("[data-snap]")!;
    expect(root.getAttribute("data-snap")).toBe("half");
    // One click on ▾ from the default height collapses (it used to grow the panel first).
    await userEvent.click(screen.getByRole("button", { name: "Shrink panel" }));
    expect(root.getAttribute("data-snap")).toBe("collapsed");
    expect(screen.queryByRole("button", { name: "Shrink panel" })).toBeNull();
    expect(screen.queryByText("stops content")).toBeNull();
    // Collapsed shows a one-line summary instead of the header (and its Edit trip button).
    expect(screen.getByText("3 stops · 2 h 5 min")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Sierra loop/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit trip" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Expand panel" }));
    expect(root.getAttribute("data-snap")).toBe("half");
    await userEvent.click(screen.getByRole("button", { name: "Expand panel" }));
    expect(root.getAttribute("data-snap")).toBe("full");
    expect(screen.queryByRole("button", { name: "Expand panel" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Shrink panel" }));
    expect(root.getAttribute("data-snap")).toBe("half");
  });
});

describe("StopsPanel tabs follow the ARIA tab pattern", () => {
  it("links tabs and panel, and uses a roving tabindex", () => {
    panel();
    const stops = screen.getByRole("tab", { name: "Stops" });
    const sugg = screen.getByRole("tab", { name: "Suggestions (3)" });
    const tabpanel = screen.getByRole("tabpanel");
    expect(stops.getAttribute("aria-controls")).toBe(tabpanel.id);
    expect(tabpanel.getAttribute("aria-labelledby")).toBe(stops.id);
    expect(stops.tabIndex).toBe(0);
    expect(sugg.tabIndex).toBe(-1);
  });

  it("moves between tabs with the arrow, Home and End keys", async () => {
    panel();
    const user = userEvent.setup();
    const stops = screen.getByRole("tab", { name: "Stops" });
    stops.focus();
    await user.keyboard("{ArrowRight}");
    const trip = screen.getByRole("tab", { name: "My trip" });
    expect(document.activeElement).toBe(trip);
    await user.keyboard("{ArrowRight}");
    const sugg = screen.getByRole("tab", { name: "Suggestions (3)" });
    expect(sugg.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(sugg);
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(sugg.id);
    await user.keyboard("{ArrowRight}"); // wraps
    expect(document.activeElement).toBe(stops);
    await user.keyboard("{ArrowLeft}"); // wraps back
    expect(document.activeElement).toBe(sugg);
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(stops);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(sugg);
    expect(sugg.tabIndex).toBe(0);
    expect(stops.tabIndex).toBe(-1);
  });
});
