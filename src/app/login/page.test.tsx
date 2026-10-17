// @vitest-environment jsdom
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ClearOfflineCopies } from "@/components/offline/ClearOfflineCopies";

const userId = vi.hoisted(() => ({ current: null as string | null }));
vi.mock("@/server/session", () => ({ getCurrentUserId: async () => userId.current }));
vi.mock("@/server/auth", () => ({ googleConfigured: () => false }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));

const has = (node: ReactNode, type: unknown): boolean => {
  if (!isValidElement(node)) return Array.isArray(node) && node.some((n) => has(n, type));
  const el = node as ReactElement<{ children?: ReactNode }>;
  return el.type === type || has(el.props.children, type);
};

describe("login page", () => {
  it("clears offline copies for a signed-out visitor", async () => {
    const { default: LoginPage } = await import("./page");
    const tree = await LoginPage({ searchParams: Promise.resolve({}) } as never);
    expect(has(tree, ClearOfflineCopies)).toBe(true);
  });
  it("redirects a signed-in visitor before rendering anything", async () => {
    userId.current = "u1";
    const { default: LoginPage } = await import("./page");
    await expect(LoginPage({ searchParams: Promise.resolve({}) } as never)).rejects.toThrow("redirect:/trips");
  });
});
