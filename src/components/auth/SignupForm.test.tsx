// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));
vi.mock("@/lib/api-client", async (orig) => ({
  ...(await orig<typeof import("@/lib/api-client")>()),
  api: { signup: vi.fn() },
}));
import { signIn } from "next-auth/react";
import { api, ApiError } from "@/lib/api-client";
import { SignupForm } from "./SignupForm";

async function submit() {
  await userEvent.type(screen.getByLabelText("Email"), "ann@example.com");
  await userEvent.type(screen.getByLabelText("Password"), "correct-horse");
  await userEvent.click(screen.getByRole("button", { name: "Create account" }));
}

describe("SignupForm", () => {
  beforeEach(() => vi.clearAllMocks());

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
});
