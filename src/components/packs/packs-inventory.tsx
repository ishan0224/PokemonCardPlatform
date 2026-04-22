"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PackSummaryCard } from "@/components/packs/pack-summary-card";
import { Button, buttonClassName } from "@/components/ui/button";
import { CardGrid } from "@/components/ui/card-grid";
import { LoadingCardGrid } from "@/components/ui/loading-card-grid";
import { PaginationFooter } from "@/components/ui/pagination-footer";
import { Segmented, type SegmentedOption } from "@/components/ui/segmented";
import { useMyPacks } from "@/hooks/use-my-packs";
import { routes } from "@/lib/routes";

type PackFilter = "unopened" | "opened" | "all";

const FILTER_OPTIONS: ReadonlyArray<SegmentedOption<PackFilter>> = [
  { id: "unopened", label: "Unopened" },
  { id: "opened", label: "Opened" },
  { id: "all", label: "All" }
] as const;

function resolveOpenedFilter(filter: PackFilter): boolean | undefined {
  if (filter === "all") {
    return undefined;
  }
  return filter === "opened";
}

function EmptyState({ filter }: { filter: PackFilter }): JSX.Element {
  if (filter === "unopened") {
    return (
      <div className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5 text-[13px] text-pv-muted">
        <p className="font-bold text-pv-text">All caught up. No unopened packs.</p>
        <p className="mt-1">Join the next drop to add more packs.</p>
        <Link
          href={routes.drops.index}
          className={`${buttonClassName({ variant: "secondary", size: "sm" })} mt-3`}
        >
          Browse drops
        </Link>
      </div>
    );
  }

  if (filter === "opened") {
    return (
      <div className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5 text-[13px] text-pv-muted">
        <p className="font-bold text-pv-text">No opened packs yet.</p>
        <p className="mt-1">Open one of your sealed packs to see reveal history here.</p>
      </div>
    );
  }

  return (
    <div className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5 text-[13px] text-pv-muted">
      <p className="font-bold text-pv-text">No packs yet.</p>
      <p className="mt-1">Buy your first pack from live drops.</p>
      <Link href={routes.drops.index} className={`${buttonClassName({ variant: "primary", size: "sm" })} mt-3`}>
        Browse drops
      </Link>
    </div>
  );
}

export function PacksInventory(): JSX.Element {
  const [filter, setFilter] = useState<PackFilter>("unopened");
  const opened = resolveOpenedFilter(filter);
  const list = useMyPacks({ opened, limit: 24 });

  const resultLabel = useMemo(
    () => `${list.packs.length} pack${list.packs.length === 1 ? "" : "s"} loaded`,
    [list.packs.length]
  );

  return (
    <section className="space-y-4" aria-labelledby="my-packs-inventory-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={FILTER_OPTIONS}
          ariaLabel="Filter packs by state"
        />
        <Button variant="secondary" size="sm" onClick={() => void list.refresh()}>
          Refresh
        </Button>
      </div>

      <p className="text-[12px] text-pv-muted" aria-live="polite">
        {resultLabel}
      </p>

      {list.loading ? (
        <div className="space-y-3">
          <p className="text-[13px] font-medium text-pv-muted">Loading packs…</p>
          <LoadingCardGrid cards={4} />
        </div>
      ) : null}
      {list.error ? (
        <p
          role="alert"
          className="rounded-pv-sm border border-pv-accent/30 bg-[rgba(239,68,68,0.08)] p-3 text-[13px] font-medium text-[#fca5a5]"
        >
          {list.error}
        </p>
      ) : null}

      {!list.loading && !list.error && list.packs.length === 0 ? <EmptyState filter={filter} /> : null}

      {!list.loading && !list.error && list.packs.length > 0 ? (
        <CardGrid
          items={list.packs}
          ariaLabel="My packs"
          itemKey={(pack) => pack.id}
          renderItem={(pack) => <PackSummaryCard pack={pack} />}
          virtualizedItemHeight={470}
        />
      ) : null}

      <PaginationFooter
        hasMore={list.hasMore}
        loading={list.loadingMore}
        onLoadMore={() => {
          void list.loadMore();
        }}
        loadedCount={list.packs.length}
      />
    </section>
  );
}
