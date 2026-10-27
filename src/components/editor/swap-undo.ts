/**
 * The last stop of the cascaded run that Undo swap may tick again, or undefined when it is not safe to re-tick.
 * Ticking a stop visited ticks every stop before it, so it is only safe while the cascaded ids are still exactly the
 * run directly after the swapped stop in the current order (nothing reordered, added or removed in between).
 */
export function retickTarget(stops: { id: string }[], swappedId: string, cascadedIds: string[]): string | undefined {
  if (cascadedIds.length === 0) return undefined;
  const at = stops.findIndex((s) => s.id === swappedId);
  if (at < 0) return undefined;
  const run = stops.slice(at + 1, at + 1 + cascadedIds.length).map((s) => s.id);
  if (run.length !== cascadedIds.length) return undefined;
  const wanted = new Set(cascadedIds);
  if (!run.every((id) => wanted.has(id))) return undefined;
  return run[run.length - 1];
}
