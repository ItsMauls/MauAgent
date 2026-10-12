export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="space-y-4 pt-4">
      <span className="sr-only">Loading…</span>
      <div className="h-9 w-56 animate-pulse rounded-xl bg-line" />
      <div className="card h-40 animate-pulse" />
      <div className="card h-64 animate-pulse" />
    </div>
  );
}
