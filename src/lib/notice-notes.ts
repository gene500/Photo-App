import type { PlaceNotice } from "./types";

export const MAX_NOTICE_NOTES = 5;

/** Optimize-status notes for the heads-ups: "Stop name: text". Visited stops and unknown indexes are skipped; extras are summarised. */
export function noticeNotes(notices: PlaceNotice[] | undefined, stops: { name: string; visited?: boolean }[]): string[] {
  const rows = (notices ?? []).flatMap((n) => {
    const s = stops[n.stopIndex];
    return s && !s.visited && typeof n.text === "string" && n.text.trim() ? [`${s.name}: ${n.text.trim()}`] : [];
  });
  const shown = rows.slice(0, MAX_NOTICE_NOTES);
  return rows.length > shown.length ? [...shown, `${rows.length - shown.length} more heads-ups for your stops`] : shown;
}
