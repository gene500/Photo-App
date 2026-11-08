// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RouteError from "./error";
import NotFound from "./not-found";

describe("error and not-found pages", () => {
  it("error.tsx shows a heading, retries, links home and leaks no message or digest", () => {
    const retry = vi.fn();
    render(<RouteError error={Object.assign(new Error("secret db password"), { digest: "abc123" })} retry={retry} />);
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/secret|abc123/);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Back to trips" }).getAttribute("href")).toBe("/");
  });

  it("not-found.tsx shows a heading and a link back", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to trips" }).getAttribute("href")).toBe("/");
  });
});
