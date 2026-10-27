// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("next-auth/react", () => ({ signIn: vi.fn(), getProviders: vi.fn() }));
vi.mock("@/lib/api-client", async (orig) => ({
  ...(await orig<typeof import("@/lib/api-client")>()),
  api: { signup: vi.fn() },
}));
import { getProviders, signIn } from "next-auth/react";
import { api, ApiError } from "@/lib/api-client";
import { SignupForm } from "./SignupForm";

async function submit() {
  await userEvent.type(screen.getByLabelText("Email"), "ann@example.com");
  await userEvent.type(screen.getByLabelText("Password"), "correct-horse");
  await userEvent.click(screen.getByRole("button", { name: "Create account" }));
}

describe("SignupForm", () => {
  it("submits by POST if used before the page is interactive, so a password never lands in the URL", () => {
    const { container } = render(<SignupForm />);
    expect(container.querySelector("form")?.getAttribute("method")).toBe("post");
  });
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(getProviders).mockResolvedValue({ credentials: {} } as never); });

  it("shows the server's validation message", async () => {
    vi.mocked(api.signup).mockRejectedValue(new ApiError(409, "An account with that email already exists"));
    render(<SignupForm />);
    await submit();
    expect((await screen.findByRole("alert")).textContent).toBe("An account with that email already exists");
  });

  it("signs in and navigates after creating the account", async () => {
    vi.mocked(api.signup).mockResolvedValue({ user: { id: "u1", email: "ann@example.com" } });
    vi.mocked(signIn).mockResolvedValue({ ok: true, error: undefined, status: 200, url: "/trips" } as never);
    render(<SignupForm />);
    await submit();
    expect(signIn).toHaveBeenCalledWith("credentials", { email: "ann@example.com", password: "correct-horse", redirect: false });
    expect(push).toHaveBeenCalledWith("/trips");
  });

  it("keeps keyboard focus on the submit button after a signup error", async () => {
    vi.mocked(api.signup).mockRejectedValue(new ApiError(400, "Email already in use"));
    render(<SignupForm />);
    await submit();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Create account" }));
  });

  it("keeps the form and shows a message when the providers endpoint fails after signup", async () => {
    vi.mocked(api.signup).mockResolvedValue({ user: { id: "u1", email: "ann@example.com" } });
    vi.mocked(getProviders).mockResolvedValue(null as never);
    render(<SignupForm />);
    await submit();
    expect((await screen.findByRole("alert")).textContent).toMatch(/signing in failed/i);
    expect(signIn).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("ann@example.com");
  });
});
