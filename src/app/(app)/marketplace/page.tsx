"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { MarketplaceListingCard } from "@/components/marketplace/marketplace-listing-card";
import { Button, buttonClassName } from "@/components/ui/button";
import { CardGrid } from "@/components/ui/card-grid";
import { InfiniteSentinel } from "@/components/ui/infinite-sentinel";
import { LoadingCardGrid } from "@/components/ui/loading-card-grid";
import { useAuth } from "@/hooks/use-auth";
import { useMarketplace } from "@/hooks/use-marketplace";
import type { MarketplaceListingActionState } from "@/components/marketplace/marketplace-listing-card";
import type { MarketplaceListing, MarketplaceSort } from "@/lib/api-client";
import { routes } from "@/lib/routes";
import type { RarityTier } from "@/lib/types";

const RARITY_OPTIONS: Array<{ label: string; value: RarityTier | "" }> = [
  { label: "All rarities", value: "" },
  { label: "Common", value: "common" },
  { label: "Uncommon", value: "uncommon" },
  { label: "Rare", value: "rare" },
  { label: "Holo rare", value: "holo_rare" },
  { label: "Ultra rare", value: "ultra_rare" },
  { label: "Chase", value: "chase" }
];

const SORT_OPTIONS: Array<{ label: string; value: MarketplaceSort }> = [
  { label: "Newest", value: "newest" },
  { label: "Price low → high", value: "price_asc" },
  { label: "Price high → low", value: "price_desc" }
];

function getListingActionState(
  listing: MarketplaceListing,
  userId: string | null,
  authLoading: boolean
): MarketplaceListingActionState {
  if (authLoading) return "loading";
  if (!userId) return "login";
  if (listing.sellerId === userId) return "owner";
  return "buy";
}

const INPUT_CLASS =
  "w-full rounded-pv-sm border border-pv-line bg-pv-surface-3 px-3 py-2 text-[13px] font-medium text-pv-text outline-none transition focus:border-pv-gold focus:ring-2 focus:ring-pv-gold/25";

export default function MarketplacePage(): JSX.Element {
  const { user, loading: authLoading } = useAuth();
  const [rarity, setRarity] = useState<RarityTier | "">("");
  const [sort, setSort] = useState<MarketplaceSort>("newest");

  const marketplace = useMarketplace({
    rarity: rarity || null,
    sort,
    limit: 24,
    enableRealtime: true
  });

  const resultLabel = useMemo(() => {
    if (marketplace.listings.length === 1) return "1 active listing";
    return `${marketplace.listings.length} loaded${
      marketplace.total ? ` of ${marketplace.total}` : ""
    }`;
  }, [marketplace.listings.length, marketplace.total]);

  return (
    <section className="space-y-5">
      {/* HEADER */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-pv-h1">Marketplace</h1>
          <p className="mt-1 text-[13px] text-pv-muted">
            Browse active listings and buy cards at listed prices in real time.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-pv-muted before:block before:h-1.5 before:w-1.5 before:rounded-full before:bg-pv-good">
            Live prices streaming
          </span>
          <Button variant="secondary" size="sm" onClick={() => void marketplace.refresh()}>
            Refresh
          </Button>
        </div>
      </header>

      {/* FILTER RAIL */}
      <section className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted">
              Rarity
              <select
                value={rarity}
                onChange={(event) => setRarity(event.target.value as RarityTier | "")}
                className={`${INPUT_CLASS} min-w-[160px]`}
              >
                {RARITY_OPTIONS.map((option) => (
                  <option key={option.label} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex items-end gap-3">
            <p className="text-[12px] text-pv-muted">{resultLabel}</p>
            <label className="flex flex-col gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted">
              Sort
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as MarketplaceSort)}
                className={`${INPUT_CLASS} min-w-[160px]`}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </section>

      {/* LOADING / ERROR / EMPTY */}
      {marketplace.loading ? (
        <div className="space-y-3">
          <p className="text-[13px] font-medium text-pv-muted">Loading marketplace…</p>
          <LoadingCardGrid cards={6} />
        </div>
      ) : null}
      {marketplace.error ? (
        <p
          role="alert"
          className="rounded-pv-sm border border-pv-accent/30 bg-[rgba(239,68,68,0.08)] p-3 text-[13px] font-medium text-[#fca5a5]"
        >
          {marketplace.error}
        </p>
      ) : null}

      {!marketplace.loading && !marketplace.error && marketplace.listings.length === 0 ? (
        <div className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5 text-[13px] text-pv-muted">
          <p className="font-bold text-pv-text">No active listings found for this filter.</p>
          <p className="mt-1">List cards from your collection to create the first matching offer.</p>
          <Link
            href={routes.collection.index}
            className={`${buttonClassName({ variant: "primary", size: "sm" })} mt-3`}
          >
            Open collection
          </Link>
        </div>
      ) : null}

      {/* GRID */}
      <CardGrid
        items={marketplace.listings}
        ariaLabel="Marketplace listings"
        itemKey={(listing) => listing.id}
        renderItem={(listing) => (
          <MarketplaceListingCard
            listing={listing}
            actionState={getListingActionState(listing, user?.id ?? null, authLoading)}
            isPending={marketplace.buyPendingListingId === listing.id}
            onBuy={marketplace.buyListing}
          />
        )}
      />

      <InfiniteSentinel
        hasMore={marketplace.hasMore}
        loading={marketplace.loadingMore}
        onLoadMore={() => {
          void marketplace.loadMore();
        }}
      />
    </section>
  );
}
