/** Heads-up for signed-in users when this month's map loads are running low. */
export function MapUsageBanner() {
  return (
    <p role="status" className="rounded-xl bg-surface px-3 py-2 text-xs text-muted shadow ring-1 ring-border">
      Map usage is high this month; the map may pause until it resets
    </p>
  );
}
