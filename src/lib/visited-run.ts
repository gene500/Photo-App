/** The visited checks always form one run from the start of the trip: checking a stop checks every earlier one, unchecking it unchecks every later one. */

type HasVisited = { id: string; visited: boolean };

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
