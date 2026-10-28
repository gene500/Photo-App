import { vi } from "vitest";
import { getCurrentUserId } from "@/server/session";

/** Makes `getCurrentUserId` return `id`; the test file must `vi.mock("@/server/session", ...)` it first. */
export const signInAs = (id: string | null) => vi.mocked(getCurrentUserId).mockResolvedValue(id);
