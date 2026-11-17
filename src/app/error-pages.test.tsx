// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RouteError from "./error";
import NotFound from "./not-found";

const cookieNames = vi.hoisted(() => ({ list: [] as string[], fail: false }));
vi.mock("next/headers", () => ({
  cookies: async () => {
    if (cookieNames.fail) throw new Error("no request scope");
    return { getAll: () => cookieNames.list.map((name) => ({ name, value: "x" })) };
  },
}));

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

  it("not-found.tsx shows a heading and a link back to trips for a signed-in visitor", async () => {
    cookieNames.list = ["next-auth.session-token"];
    render(await NotFound());
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to trips" }).getAttribute("href")).toBe("/");
  });

  it("not-found.tsx offers a neutral link to a signed-out visitor, and when cookies cannot be read", async () => {
    cookieNames.list = ["theme"];
    const { unmount } = render(await NotFound());
    expect(screen.queryByRole("link", { name: "Back to trips" })).toBeNull();
    expect(screen.getByRole("link", { name: "Go to home page" }).getAttribute("href")).toBe("/");
    unmount();
    cookieNames.fail = true;
    render(await NotFound());
    expect(screen.getByRole("link", { name: "Go to home page" })).toBeTruthy();
    cookieNames.fail = false;
  });
});
