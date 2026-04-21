"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { DropListItem } from "@/components/drops/drop-list-item";
import { Button } from "@/components/ui/button";
import { buttonClassName } from "@/components/ui/button-styles";
import { CardGrid } from "@/components/ui/card-grid";
import { InfiniteSentinel } from "@/components/ui/infinite-sentinel";
import { LoadingCardGrid } from "@/components/ui/loading-card-grid";
import { PaginationFooter } from "@/components/ui/pagination-footer";
import { useDropsByStatus } from "@/hooks/use-drops";
import { routes } from "@/lib/routes";
import { subscribeToDropRoom } from "@/lib/socket-client";

export default function DropsPage(): JSX.Element {
  const upcoming = useDropsByStatus("upcoming", 6);
  const live = useDropsByStatus("active", 12);
  const refreshUpcoming = upcoming.refresh;
  const refreshLive = live.refresh;

  const realtimeDropIds = useMemo(
    () => [...new Set([...upcoming.drops.map((drop) => drop.id), ...live.drops.map((drop) => drop.id)])],
    [live.drops, upcoming.drops]
  );

  useEffect(() => {
    if (realtimeDropIds.length === 0) {
      return;
    }

    const unsubscribers = realtimeDropIds.map((dropId) =>
      subscribeToDropRoom(dropId, {
        onDropStarted: () => {
          void Promise.all([refreshUpcoming(), refreshLive()]);
        },
        onDropCompleted: () => {
          void Promise.all([refreshUpcoming(), refreshLive()]);
        }
      })
    );

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [realtimeDropIds, refreshLive, refreshUpcoming]);

  return (
    <section className="space-y-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-slate-950">Drops</h1>
          <p className="mt-1 text-sm text-slate-600">Track upcoming schedules and live inventory in real time.</p>
        </div>

        <Button
          variant="secondary"
          onClick={() => {
            void Promise.all([refreshUpcoming(), refreshLive()]);
          }}
        >
          Refresh
        </Button>
      </div>

      <section aria-labelledby="upcoming-drops-heading" className="space-y-4">
        <header className="space-y-1">
          <h2 id="upcoming-drops-heading" className="text-2xl font-black text-amber-700">
            Upcoming Drops
          </h2>
          <p className="text-sm text-slate-600" aria-live="polite">
            {upcoming.drops.length} scheduled drop{upcoming.drops.length === 1 ? "" : "s"} loaded.
          </p>
        </header>

        {upcoming.loading ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-600">Loading upcoming drops...</p>
            <LoadingCardGrid cards={3} minItemWidth={420} itemHeightClassName="h-[520px]" />
          </div>
        ) : null}
        {upcoming.error ? (
          <p className="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{upcoming.error}</p>
        ) : null}

        {!upcoming.loading && !upcoming.error && upcoming.drops.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
            <p className="font-semibold text-slate-900">No upcoming drops right now.</p>
            <p className="mt-1">Explore live inventory while we prepare the next schedule.</p>
            <Link href={routes.drops.index} className={`${buttonClassName({ variant: "secondary", size: "sm" })} mt-3`}>
              View Live Drops
            </Link>
          </div>
        ) : null}

        <CardGrid
          items={upcoming.drops}
          ariaLabel="Upcoming drops"
          itemKey={(drop) => drop.id}
          minItemWidth={420}
          virtualizedItemHeight={560}
          renderItem={(drop, index) => <DropListItem drop={drop} showCountdown priority={index < 6} />}
        />

        {upcoming.drops.length > 0 ? (
          <PaginationFooter
            hasMore={upcoming.hasMore}
            loading={upcoming.loadingMore}
            onLoadMore={() => {
              void upcoming.loadMore();
            }}
            loadedCount={upcoming.drops.length}
          />
        ) : null}
      </section>

      <section aria-labelledby="live-drops-heading" className="space-y-4">
        <header className="space-y-1">
          <h2 id="live-drops-heading" className="text-2xl font-black text-emerald-700">
            Live Drops
          </h2>
          <p className="text-sm text-slate-600" aria-live="polite">
            {live.drops.length} active drop{live.drops.length === 1 ? "" : "s"} loaded.
          </p>
        </header>

        {live.loading ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-600">Loading live drops...</p>
            <LoadingCardGrid cards={3} minItemWidth={420} itemHeightClassName="h-[520px]" />
          </div>
        ) : null}
        {live.error ? <p className="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{live.error}</p> : null}

        {!live.loading && !live.error && live.drops.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
            <p className="font-semibold text-slate-900">No live drops right now.</p>
            <p className="mt-1">Browse upcoming schedules and set a reminder to return at launch time.</p>
          </div>
        ) : null}

        <CardGrid
          items={live.drops}
          ariaLabel="Live drops"
          itemKey={(drop) => drop.id}
          minItemWidth={420}
          virtualizedItemHeight={560}
          renderItem={(drop, index) => <DropListItem drop={drop} showCountdown={false} priority={index < 6} />}
        />

        <InfiniteSentinel
          hasMore={live.hasMore}
          loading={live.loadingMore}
          onLoadMore={() => {
            void live.loadMore();
          }}
        />
      </section>
    </section>
  );
}
