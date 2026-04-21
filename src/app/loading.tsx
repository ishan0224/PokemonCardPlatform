export default function RootLoading(): JSX.Element {
  return (
    <section className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="h-8 w-56 animate-pulse rounded-lg bg-pv-parchment-soft" />
      <div className="h-28 animate-pulse rounded-2xl border border-pv-border bg-white" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="h-40 animate-pulse rounded-2xl border border-pv-border bg-white" />
        <div className="h-40 animate-pulse rounded-2xl border border-pv-border bg-white" />
        <div className="h-40 animate-pulse rounded-2xl border border-pv-border bg-white" />
      </div>
    </section>
  );
}
