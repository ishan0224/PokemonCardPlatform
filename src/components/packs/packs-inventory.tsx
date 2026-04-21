"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { PackSummaryCard } from "@/components/packs/pack-summary-card";
import { Button, buttonClassName } from "@/components/ui/button";
import { CardGrid } from "@/components/ui/card-grid";
import { LoadingCardGrid } from "@/components/ui/loading-card-grid";
import { PaginationFooter } from "@/components/ui/pagination-footer";
import { useMyPacks } from "@/hooks/use-my-packs";
import { routes } from "@/lib/routes";

type PackFilter = "unopened" | "opened" | "all";

type FilterOption = {
  id: PackFilter;
  label: string;
};

const FILTER_OPTIONS: readonly FilterOption[] = [
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

function toNextFilter(current: PackFilter, direction: 1 | -1): PackFilter {
  const currentIndex = FILTER_OPTIONS.findIndex((option) => option.id === current);
  const nextIndex = (currentIndex + direction + FILTER_OPTIONS.length) % FILTER_OPTIONS.length;
  return FILTER_OPTIONS[nextIndex].id;
}

function EmptyState({ filter }: { filter: PackFilter }): JSX.Element {
  if (filter === "unopened") {
    return (
      <div className="rounded-2xl border border-pv-border bg-white p-5 text-sm text-pv-muted">
        <p className="font-semibold text-pv-ink">All caught up. No unopened packs.</p>
        <p className="mt-1">Join the next drop to add more packs.</p>
        <Link href={routes.drops.index} className={`${buttonClassName({ variant: "secondary", size: "sm" })} mt-3`}>
          Browse Drops
        </Link>
      </div>
    );
  }

  if (filter === "opened") {
    return (
      <div className="rounded-2xl border border-pv-border bg-white p-5 text-sm text-pv-muted">
        <p className="font-semibold text-pv-ink">No opened packs yet.</p>
        <p className="mt-1">Open one of your sealed packs to see reveal history here.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-pv-border bg-white p-5 text-sm text-pv-muted">
      <p className="font-semibold text-pv-ink">No packs yet.</p>
      <p className="mt-1">Buy your first pack from live drops.</p>
      <Link href={routes.drops.index} className={`${buttonClassName({ variant: "primary", size: "sm" })} mt-3`}>
        Browse Drops
      </Link>
    </div>
  );
}

export function PacksInventory(): JSX.Element {
  const [filter, setFilter] = useState<PackFilter>("unopened");
  const tabRefs = useRef<Record<PackFilter, HTMLButtonElement | null>>({
    unopened: null,
    opened: null,
    all: null
  });
  const opened = resolveOpenedFilter(filter);
  const list = useMyPacks({ opened, limit: 24 });

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: PackFilter): void => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      const next = toNextFilter(current, 1);
      setFilter(next);
      tabRefs.current[next]?.focus();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      const next = toNextFilter(current, -1);
      setFilter(next);
      tabRefs.current[next]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      setFilter("unopened");
      tabRefs.current.unopened?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      setFilter("all");
      tabRefs.current.all?.focus();
    }
  };

  const resultLabel = useMemo(() => `${list.packs.length} pack${list.packs.length === 1 ? "" : "s"} loaded`, [list.packs.length]);

  return (
    <section className="space-y-4" aria-labelledby="my-packs-inventory-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Filter packs by state" className="inline-flex rounded-xl border border-pv-border bg-white p-1">
          {FILTER_OPTIONS.map((option) => {
            const selected = filter === option.id;
            return (
              <button
                key={option.id}
                ref={(node) => {
                  tabRefs.current[option.id] = node;
                }}
                role="tab"
                id={`packs-filter-${option.id}`}
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                type="button"
                onClick={() => setFilter(option.id)}
                onKeyDown={(event) => onTabKeyDown(event, option.id)}
                className={`min-h-11 rounded-lg px-3 text-sm font-semibold transition ${
                  selected ? "bg-pv-accent text-white" : "text-pv-ink hover:bg-pv-parchment-soft"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <Button variant="secondary" onClick={() => void list.refresh()}>
          Refresh
        </Button>
      </div>

      <p className="text-sm text-pv-muted" aria-live="polite">
        {resultLabel}
      </p>

      {list.loading ? (
        <div className="space-y-3">
          <p className="text-sm font-medium text-pv-muted">Loading packs...</p>
          <LoadingCardGrid cards={4} />
        </div>
      ) : null}
      {list.error ? <p className="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{list.error}</p> : null}

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
