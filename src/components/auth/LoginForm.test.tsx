// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));
import { signIn } from "next-auth/react";
import { LoginForm } from "./LoginForm";

async function submit() {
  await userEvent.type(screen.getByLabelText("Email"), "ann@example.com");
  await userEvent.type(screen.getByLabelText("Password"), "correct-horse");
  await userEvent.click(screen.getByRole("button", { name: "Log in" }));
}

describe("LoginForm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows an inline error for bad credentials", async () => {
    vi.mocked(signIn).mockResolvedValue({ error: "CredentialsSignin", ok: false, status: 401, url: null, code: undefined } as never);
    render(<LoginForm />);
    await submit();
    expect((await screen.findByRole("alert")).textContent).toBe("Invalid email or password");
    expect(push).not.toHaveBeenCalled();
  });

  it("navigates to /trips on success", async () => {
    vi.mocked(signIn).mockResolvedValue({ error: undefined, ok: true, status: 200, url: "/trips" } as never);
    render(<LoginForm />);
    await submit();
    expect(signIn).toHaveBeenCalledWith("credentials", { email: "ann@example.com", password: "correct-horse", redirect: false });
    expect(push).toHaveBeenCalledWith("/trips");
  });
});
