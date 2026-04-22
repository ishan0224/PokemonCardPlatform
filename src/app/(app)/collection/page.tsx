"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CollectionCard } from "@/components/collection/collection-card";
import { CollectionSummary } from "@/components/collection/collection-summary";
import { Button, buttonClassName } from "@/components/ui/button";
import { CardGrid } from "@/components/ui/card-grid";
import { LoadingCardGrid } from "@/components/ui/loading-card-grid";
import { PaginationFooter } from "@/components/ui/pagination-footer";
import { Segmented, type SegmentedOption } from "@/components/ui/segmented";
import { useCollection } from "@/hooks/use-collection";
import { useCreateAuction } from "@/hooks/use-create-auction";
import { useAuth } from "@/hooks/use-auth";
import { routes } from "@/lib/routes";
import type { CardState, RarityTier } from "@/lib/types";
import type { CollectionSort } from "@/lib/api-client";

type StateFilter = "all" | CardState;

const STATE_OPTIONS: ReadonlyArray<SegmentedOption<StateFilter>> = [
  { id: "all", label: "All" },
  { id: "owned", label: "Owned" },
  { id: "listed", label: "Listed" },
  { id: "in_auction", label: "In auction" }
] as const;

const RARITY_OPTIONS: Array<{ label: string; value: RarityTier | "" }> = [
  { label: "All rarities", value: "" },
  { label: "Common", value: "common" },
  { label: "Uncommon", value: "uncommon" },
  { label: "Rare", value: "rare" },
  { label: "Holo rare", value: "holo_rare" },
  { label: "Ultra rare", value: "ultra_rare" },
  { label: "Chase", value: "chase" }
];

const SORT_OPTIONS: Array<{ label: string; value: CollectionSort }> = [
  { label: "Newest", value: "newest" },
  { label: "Value high → low", value: "value_desc" },
  { label: "Value low → high", value: "value_asc" },
  { label: "P&L high → low", value: "pnl_desc" },
  { label: "P&L low → high", value: "pnl_asc" }
];

const INPUT_CLASS =
  "w-full rounded-pv-sm border border-pv-line bg-pv-surface-3 px-3 py-2 text-[13px] font-medium text-pv-text outline-none transition focus:border-pv-gold focus:ring-2 focus:ring-pv-gold/25";

export default function CollectionPage(): JSX.Element {
  const { user, loading: authLoading } = useAuth();
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [rarity, setRarity] = useState<RarityTier | "">("");
  const [sort, setSort] = useState<CollectionSort>("value_desc");
  const createAuction = useCreateAuction();

  const collection = useCollection({
    rarity: rarity || null,
    state: stateFilter === "all" ? null : stateFilter,
    sort,
    limit: 24,
    enabled: Boolean(user),
    enableRealtime: Boolean(user)
  });

  const resultLabel = useMemo(() => {
    if (collection.cards.length === 1) return "1 card";
    return `${collection.cards.length}${collection.total ? ` of ${collection.total}` : ""}`;
  }, [collection.cards.length, collection.total]);

  if (authLoading) {
    return <p className="text-[13px] font-medium text-pv-muted">Checking session…</p>;
  }

  if (!user) {
    return (
      <section className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-6">
        <h1 className="text-pv-h2">Your collection</h1>
        <p className="mt-2 text-[13px] text-pv-muted">
          Log in to view your cards, list them, and track P&L.
        </p>
        <Link
          href={routes.auth.login}
          className={`${buttonClassName({ variant: "primary" })} mt-4`}
        >
          Go to login
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      {/* PORTFOLIO HEADER CARD */}
      <CollectionSummary portfolio={collection.portfolio} />

      {/* FILTERS */}
      <section className="flex flex-wrap items-end justify-between gap-3">
        <Segmented
          value={stateFilter}
          onChange={setStateFilter}
          options={STATE_OPTIONS}
          ariaLabel="Filter collection by state"
        />
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted">
            Rarity
            <select
              value={rarity}
              onChange={(event) => setRarity(event.target.value as RarityTier | "")}
              className={`${INPUT_CLASS} min-w-[150px]`}
            >
              {RARITY_OPTIONS.map((option) => (
                <option key={option.label} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted">
            Sort
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as CollectionSort)}
              className={`${INPUT_CLASS} min-w-[180px]`}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted">
              Results
            </span>
            <Button variant="secondary" size="sm" onClick={() => void collection.refresh()}>
              {resultLabel} · Refresh
            </Button>
          </div>
        </div>
      </section>

      {/* LOADING / ERROR / EMPTY */}
      {collection.loading ? (
        <div className="space-y-3">
          <p className="text-[13px] font-medium text-pv-muted">Loading collection…</p>
          <LoadingCardGrid cards={6} />
        </div>
      ) : null}
      {collection.error ? (
        <p
          role="alert"
          className="rounded-pv-sm border border-pv-accent/30 bg-[rgba(239,68,68,0.08)] p-3 text-[13px] font-medium text-[#fca5a5]"
        >
          {collection.error}
        </p>
      ) : null}

      {!collection.loading && !collection.error && collection.cards.length === 0 ? (
        <div className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5 text-[13px] text-pv-muted">
          <p className="font-bold text-pv-text">No cards found for this filter.</p>
          <p className="mt-1">Open packs from drops to add cards to your inventory.</p>
          <Link
            href={routes.drops.index}
            className={`${buttonClassName({ variant: "secondary", size: "sm" })} mt-3`}
          >
            Browse drops
          </Link>
        </div>
      ) : null}

      {/* GRID */}
      <CardGrid
        items={collection.cards}
        ariaLabel="Collection cards"
        itemKey={(card) => card.id}
        renderItem={(card) => (
          <CollectionCard
            card={card}
            listingPending={collection.listingPendingCardId === card.id}
            cancelPending={collection.cancelPendingListingId === card.activeListing?.id}
            auctionPending={createAuction.pendingCardId === card.id}
            onCreateListing={collection.createListing}
            onCancelListing={collection.cancelListing}
            onStartAuction={createAuction.createAuction}
          />
        )}
      />

      <PaginationFooter
        hasMore={collection.hasMore}
        loading={collection.loadingMore}
        onLoadMore={() => {
          void collection.loadMore();
        }}
        loadedCount={collection.cards.length}
        totalCount={collection.total}
      />
    </section>
  );
}
