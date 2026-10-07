import type { Stop } from "./types";

export const STOP_COLORS = {
  manual: "#2563eb",
  manualVisited: "#93c5fd",
  suggested: "#d97706",
  suggestedVisited: "#fcd34d",
} as const;

export function stopColor(stop: Pick<Stop, "source" | "visited">): string {
  if (stop.source === "manual") return stop.visited ? STOP_COLORS.manualVisited : STOP_COLORS.manual;
  return stop.visited ? STOP_COLORS.suggestedVisited : STOP_COLORS.suggested;
}
