/** Which ids to create, update in place, and remove when going from `prev` to `next`. */
export function diffIds(prev: Iterable<string>, next: readonly string[]) {
  const before = new Set(prev);
  const after = new Set(next);
  return {
    add: next.filter((id) => !before.has(id)),
    keep: next.filter((id) => before.has(id)),
    remove: [...before].filter((id) => !after.has(id)),
  };
}
