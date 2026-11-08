import type { ShotItem } from "@/lib/types";

/** Read-only shot notes and checklist of a stop (offline copy and shared trip). */
export function ShotListReadOnly({ notes, checklist }: { notes: string | null; checklist: ShotItem[] }) {
  return (
    <>
      {notes && <p className="whitespace-pre-wrap break-words text-xs">{notes}</p>}
      {checklist.length > 0 && (
        <ul className="space-y-0.5 break-words text-xs">
          {checklist.map((item, j) => (
            <li key={j} className={item.done ? "text-muted line-through" : ""}>
              <span aria-hidden>{item.done ? "☑" : "☐"}</span> {item.text}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
