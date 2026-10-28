/**
 * Shown the instant a nav tab is clicked, while the next page loads its data on
 * the server. Without it the old page stays on screen until the new one is fully
 * rendered, which reads as the click not registering.
 */
export default function Loading() {
  return (
    <div className="space-y-4 page-fade" aria-busy="true" aria-label="Loading">
      <div className="h-6 w-48 animate-pulse rounded bg-white/[0.05]" />
      <div className="h-[420px] animate-pulse rounded-xl border border-border-subtle bg-white/[0.025]" />
    </div>
  );
}
