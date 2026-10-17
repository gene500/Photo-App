import type { KeyboardCoordinateGetter } from "@dnd-kit/core";

type Box = { top: number; left: number; width: number; height: number };

/**
 * Where the dragged row's top-left corner should go for one arrow press: the row's centre is lined up with
 * the centre of the neighbouring row, so closestCenter picks that neighbour whatever the two heights are.
 * (dnd-kit's own getter aligns top edges, which stalls a tall row next to a short one.)
 */
export function neighbourCoordinates(
  key: "ArrowUp" | "ArrowDown", rects: { id: string; rect: Box }[], currentId: string, dragged: Box,
): { x: number; y: number } | null {
  const sorted = [...rects].sort((a, b) => a.rect.top - b.rect.top);
  const at = sorted.findIndex((r) => r.id === currentId);
  if (at === -1) return null;
  const next = sorted[at + (key === "ArrowDown" ? 1 : -1)];
  if (!next) return null;
  return { x: next.rect.left, y: next.rect.top + next.rect.height / 2 - dragged.height / 2 };
}

export const centreAlignedKeyboardCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  if (event.code !== "ArrowUp" && event.code !== "ArrowDown") return undefined;
  event.preventDefault();
  const { active, collisionRect, droppableRects, droppableContainers, over } = context;
  if (!active || !collisionRect) return undefined;
  const rects: { id: string; rect: Box }[] = [];
  droppableContainers.getEnabled().forEach((c) => {
    const rect = droppableRects.get(c.id);
    if (rect) rects.push({ id: String(c.id), rect });
  });
  return neighbourCoordinates(event.code, rects, String(over?.id ?? active.id), collisionRect) ?? undefined;
};
