import type { Stop, StopPriority } from "./types";

export const STOP_COLORS = {
  manual: "#3b3226",
  manualVisited: "#b8a272",
  suggested: "#b4572f",
  suggestedVisited: "#e0a98a",
} as const;

export function stopColor(stop: Pick<Stop, "source" | "visited">): string {
  if (stop.source === "manual") return stop.visited ? STOP_COLORS.manualVisited : STOP_COLORS.manual;
  return stop.visited ? STOP_COLORS.suggestedVisited : STOP_COLORS.suggested;
}

export const PRIORITIES: StopPriority[] = ["normal", "high", "must"];
export const PRIORITY_LABEL: Record<StopPriority, string> = { normal: "Normal", high: "High", must: "Must-have" };
