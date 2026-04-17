"use client";

import { DropListItem } from "@/components/drops/drop-list-item";
import { useDrops } from "@/hooks/use-drops";

export default function DropsPage(): JSX.Element {
  const { drops, loading, error, refresh } = useDrops(20);

  return (
    <section>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-slate-950">Live Drops</h1>
          <p className="mt-1 text-sm text-slate-600">Track inventory, timing, and tier availability in real time.</p>
        </div>

        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500 hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      {loading ? <p className="text-sm font-medium text-slate-600">Loading drops...</p> : null}
      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{error}</p> : null}

      {!loading && !error && drops.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">No drops available yet.</div>
      ) : null}

      <div className="space-y-4">
        {drops.map((drop) => (
          <DropListItem key={drop.id} drop={drop} />
        ))}
      </div>
    </section>
  );
}
