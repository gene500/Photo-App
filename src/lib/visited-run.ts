/** The visited checks always form one run from the start of the trip: checking a stop checks every earlier one, unchecking it unchecks every later one. */

type HasVisited = { id: string; visited: boolean };

/** Ids whose `visited` has to change to `visited` so the checks stay one run from the start (the toggled stop included). */
export function visitedChanges(stops: HasVisited[], id: string, visited: boolean): string[] {
  const at = stops.findIndex((s) => s.id === id);
  if (at < 0) return [];
  const span = visited ? stops.slice(0, at + 1) : stops.slice(at);
  return span.filter((s) => s.visited !== visited).map((s) => s.id);
}

/** How many stops, counted from the start, are visited without a gap. */
export function leadingVisited(stops: { visited: boolean }[]): number {
  const n = stops.findIndex((s) => !s.visited);
  return n < 0 ? stops.length : n;
}

/** Reorder request made safe: visited stops stay first in their current order, the unvisited ones follow in the requested relative order. */
export function pinVisitedFirst(currentOrder: HasVisited[], requestedIds: string[]): string[] {
  const visited = currentOrder.filter((s) => s.visited).map((s) => s.id);
  const pinned = new Set(visited);
  return [...visited, ...requestedIds.filter((id) => !pinned.has(id))];
}
