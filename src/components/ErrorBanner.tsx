export function ErrorBanner({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start justify-between gap-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
      <span>{message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss error" className="font-semibold">
        ×
      </button>
    </div>
  );
}
