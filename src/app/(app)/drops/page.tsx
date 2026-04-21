"use client";

import { DropListItem } from "@/components/drops/drop-list-item";
import { Button } from "@/components/ui/button";
import { CardGrid } from "@/components/ui/card-grid";
import { InfiniteSentinel } from "@/components/ui/infinite-sentinel";
import { useDrops } from "@/hooks/use-drops";

export default function DropsPage(): JSX.Element {
  const { drops, loading, loadingMore, error, hasMore, refresh, loadMore } = useDrops(12);

  return (
    <section>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-slate-950">Live Drops</h1>
          <p className="mt-1 text-sm text-slate-600">Track inventory, timing, and tier availability in real time.</p>
        </div>

        <Button variant="secondary" onClick={() => void refresh()}>
          Refresh
        </Button>
      </div>

      {loading ? <p className="text-sm font-medium text-slate-600">Loading drops...</p> : null}
      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{error}</p> : null}

      {!loading && !error && drops.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">No drops available yet.</div>
      ) : null}

      <CardGrid
        items={drops}
        ariaLabel="Drops"
        itemKey={(drop) => drop.id}
        minItemWidth={420}
        virtualizedItemHeight={980}
        renderItem={(drop) => <DropListItem drop={drop} />}
      />

      <InfiniteSentinel
        hasMore={hasMore}
        loading={loadingMore}
        onLoadMore={() => {
          void loadMore();
        }}
      />
    </section>
  );
}
