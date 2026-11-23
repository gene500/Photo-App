import { beforeEach, describe, expect, it, vi } from "vitest";

const mapLoadState = vi.fn();
vi.mock("@/server/budget", () => ({ mapLoadState: () => mapLoadState() }));
vi.mock("@/server/session", () => ({ getCurrentUserId: vi.fn(async () => "u1") }));
vi.mock("@/server/trips", () => ({ getTrip: vi.fn(async () => ({ id: "t1", name: "Trip", stops: [] })) }));
vi.mock("react-dom", () => ({ preconnect: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));

import TripPage from "./page";

type Props = { mapAllowed: boolean; mapUsageHigh: boolean };
async function editorProps(): Promise<Props> {
  const el = (await TripPage({ params: Promise.resolve({ id: "t1" }) } as never)) as { props: { children: { props: Props }[] } };
  return el.props.children[1]!.props;
}

describe("trip page map state", () => {
  beforeEach(() => mapLoadState.mockReset());

  it.each([
    ["ok", true, false],
    ["warn", true, true],
    ["shared-off", true, true],
    ["all-off", false, true],
  ] as const)("at %s: mapAllowed %s, banner %s", async (state, allowed, high) => {
    mapLoadState.mockResolvedValue(state);
    expect(await editorProps()).toMatchObject({ mapAllowed: allowed, mapUsageHigh: high });
  });
});
