"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DropListItem } from "@/components/drops/drop-list-item";
import { Button, buttonClassName } from "@/components/ui/button";
import { CardGrid } from "@/components/ui/card-grid";
import { Chip, type ChipTone } from "@/components/ui/chip";
import { CountdownPill } from "@/components/ui/countdown-pill";
import { HeroBand } from "@/components/ui/hero-band";
import { InfiniteSentinel } from "@/components/ui/infinite-sentinel";
import { LoadingCardGrid } from "@/components/ui/loading-card-grid";
import { PaginationFooter } from "@/components/ui/pagination-footer";
import { Segmented, type SegmentedOption } from "@/components/ui/segmented";
import { useDropsByStatus } from "@/hooks/use-drops";
import { dropPackImageDimensions, dropPackImagePath } from "@/lib/drop-pack-image";
import { routes } from "@/lib/routes";
import { subscribeToDropRoom } from "@/lib/socket-client";
import type { Drop } from "@/lib/api-client";

type DropsFilter = "all" | "live" | "upcoming";

const FILTER_OPTIONS: ReadonlyArray<SegmentedOption<DropsFilter>> = [
  { id: "all", label: "All" },
  { id: "live", label: "Live" },
  { id: "upcoming", label: "Upcoming" }
] as const;

function pickHeroDrop(upcoming: Drop[], live: Drop[]): Drop | null {
  const nextUpcoming = [...upcoming].sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
  )[0];
  if (nextUpcoming) return nextUpcoming;
  const newestLive = [...live].sort(
    (a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime()
  )[0];
  return newestLive ?? null;
}

function DropsHero({ drop }: { drop: Drop }): JSX.Element {
  const tiers = drop.tiers.map((t) => t.tier);
  const imagePath = dropPackImagePath(tiers);
  const imageDims = dropPackImageDimensions(tiers);
  const isLive = drop.status === "active";
  const chipTone: ChipTone = isLive ? "live" : "upcoming";

  return (
    <HeroBand
      aspect="21/7"
      preview={
        <Image
          src={imagePath}
          alt=""
          width={imageDims.width}
          height={imageDims.height}
          className="h-auto w-full object-contain drop-shadow-[0_30px_60px_rgba(0,0,0,0.55)]"
          aria-hidden="true"
          priority
        />
      }
    >
      <Chip tone={chipTone} pulse={isLive}>
        {isLive ? "Live now" : "Upcoming"}
      </Chip>
      <h2 className="mt-2.5 text-pv-h1" style={{ fontSize: 36 }}>
        Drop {drop.id.slice(0, 8)}
      </h2>
      <p className="mt-1.5 max-w-[500px] text-[13px] text-pv-muted">
        {drop.tiers.length} tier{drop.tiers.length === 1 ? "" : "s"} · provably fair
      </p>
      <div className="mt-3.5 flex items-center gap-3">
        {!isLive ? <CountdownPill targetIso={drop.scheduledAt} /> : null}
        <Link
          href={routes.drops.detail(drop.id)}
          className={buttonClassName({ variant: "primary" })}
        >
          {isLive ? "Rip a pack" : "View drop"}
        </Link>
      </div>
    </HeroBand>
  );
}

export default function DropsPage(): JSX.Element {
  const [filter, setFilter] = useState<DropsFilter>("all");
  const upcoming = useDropsByStatus("upcoming", 6);
  const live = useDropsByStatus("active", 12);
  const refreshUpcoming = upcoming.refresh;
  const refreshLive = live.refresh;

  const realtimeDropIds = useMemo(
    () => [...new Set([...upcoming.drops.map((d) => d.id), ...live.drops.map((d) => d.id)])],
    [live.drops, upcoming.drops]
  );

  useEffect(() => {
    if (realtimeDropIds.length === 0) return;
    const unsubs = realtimeDropIds.map((dropId) =>
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
      for (const u of unsubs) u();
    };
  }, [realtimeDropIds, refreshLive, refreshUpcoming]);

  const hero = pickHeroDrop(upcoming.drops, live.drops);
  const showUpcoming = filter === "all" || filter === "upcoming";
  const showLive = filter === "all" || filter === "live";

  const totalResults = upcoming.drops.length + live.drops.length;
  const resultLabel = useMemo(
    () => `${totalResults} drop${totalResults === 1 ? "" : "s"} loaded`,
    [totalResults]
  );

  return (
    <section className="space-y-6">
      {/* HEADER */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-pv-h1">Live drops</h1>
          <p className="mt-1 text-[13px] text-pv-muted">
            Scheduled inventory releases. One card per drop; composite image reflects tier mix.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            void Promise.all([refreshUpcoming(), refreshLive()]);
          }}
        >
          Refresh
        </Button>
      </header>

      {/* HERO */}
      {hero ? <DropsHero drop={hero} /> : null}

      {/* FILTER RAIL */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={FILTER_OPTIONS}
          ariaLabel="Drop status filter"
        />
        <p className="text-[12px] text-pv-muted" aria-live="polite">
          {resultLabel}
        </p>
      </div>

      {/* UPCOMING SECTION */}
      {showUpcoming ? (
        <section aria-labelledby="upcoming-drops-heading" className="space-y-4">
          <header className="flex items-end justify-between gap-3">
            <h2 id="upcoming-drops-heading" className="text-pv-h2">
              Upcoming
            </h2>
            <p className="text-[12px] text-pv-muted">
              {upcoming.drops.length} drop{upcoming.drops.length === 1 ? "" : "s"}
            </p>
          </header>

          {upcoming.loading ? (
            <div className="space-y-3">
              <p className="text-[13px] font-medium text-pv-muted">Loading upcoming drops…</p>
              <LoadingCardGrid cards={3} minItemWidth={320} itemHeightClassName="h-[460px]" />
            </div>
          ) : null}
          {upcoming.error ? (
            <p
              role="alert"
              className="rounded-pv-sm border border-pv-accent/30 bg-[rgba(239,68,68,0.08)] p-3 text-[13px] font-medium text-[#fca5a5]"
            >
              {upcoming.error}
            </p>
          ) : null}

          {!upcoming.loading && !upcoming.error && upcoming.drops.length === 0 ? (
            <div className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5 text-[13px] text-pv-muted">
              <p className="font-bold text-pv-text">No upcoming drops right now.</p>
              <p className="mt-1">Check back soon — new drops are scheduled regularly.</p>
            </div>
          ) : null}

          <CardGrid
            items={upcoming.drops}
            ariaLabel="Upcoming drops"
            itemKey={(drop) => drop.id}
            minItemWidth={320}
            virtualizedItemHeight={470}
            renderItem={(drop, index) => (
              <DropListItem drop={drop} showCountdown priority={index < 3} />
            )}
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
      ) : null}

      {/* LIVE SECTION */}
      {showLive ? (
        <section aria-labelledby="live-drops-heading" className="space-y-4">
          <header className="flex items-end justify-between gap-3">
            <h2 id="live-drops-heading" className="text-pv-h2">
              Live now
            </h2>
            <p className="text-[12px] text-pv-muted">
              {live.drops.length} drop{live.drops.length === 1 ? "" : "s"}
            </p>
          </header>

          {live.loading ? (
            <div className="space-y-3">
              <p className="text-[13px] font-medium text-pv-muted">Loading live drops…</p>
              <LoadingCardGrid cards={4} minItemWidth={280} itemHeightClassName="h-[440px]" />
            </div>
          ) : null}
          {live.error ? (
            <p
              role="alert"
              className="rounded-pv-sm border border-pv-accent/30 bg-[rgba(239,68,68,0.08)] p-3 text-[13px] font-medium text-[#fca5a5]"
            >
              {live.error}
            </p>
          ) : null}

          {!live.loading && !live.error && live.drops.length === 0 ? (
            <div className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5 text-[13px] text-pv-muted">
              <p className="font-bold text-pv-text">No live drops right now.</p>
              <p className="mt-1">
                Browse upcoming schedules and return at launch time.{" "}
                <Link href={routes.drops.index} className="text-pv-gold hover:underline">
                  See upcoming →
                </Link>
              </p>
            </div>
          ) : null}

          <CardGrid
            items={live.drops}
            ariaLabel="Live drops"
            itemKey={(drop) => drop.id}
            minItemWidth={280}
            virtualizedItemHeight={440}
            renderItem={(drop, index) => (
              <DropListItem drop={drop} showCountdown={false} priority={index < 4} />
            )}
          />

          <InfiniteSentinel
            hasMore={live.hasMore}
            loading={live.loadingMore}
            onLoadMore={() => {
              void live.loadMore();
            }}
          />
        </section>
      ) : null}
    </section>
  );
}
