"use client";

import { useMemo, useState } from "react";
import { MarketplaceListingCard } from "@/components/marketplace/marketplace-listing-card";
import { Button } from "@/components/ui/button";
import { CardGrid } from "@/components/ui/card-grid";
import { InfiniteSentinel } from "@/components/ui/infinite-sentinel";
import { useAuth } from "@/hooks/use-auth";
import { useMarketplace } from "@/hooks/use-marketplace";
import type { MarketplaceListingActionState } from "@/components/marketplace/marketplace-listing-card";
import type { MarketplaceListing, MarketplaceSort } from "@/lib/api-client";
import type { RarityTier } from "@/lib/types";

const RARITY_OPTIONS: Array<{ label: string; value: RarityTier | "" }> = [
  { label: "All Rarities", value: "" },
  { label: "Common", value: "common" },
  { label: "Uncommon", value: "uncommon" },
  { label: "Rare", value: "rare" },
  { label: "Holo Rare", value: "holo_rare" },
  { label: "Ultra Rare", value: "ultra_rare" },
  { label: "Chase", value: "chase" }
];

const SORT_OPTIONS: Array<{ label: string; value: MarketplaceSort }> = [
  { label: "Newest", value: "newest" },
  { label: "Price Low-High", value: "price_asc" },
  { label: "Price High-Low", value: "price_desc" }
];

function getListingActionState(
  listing: MarketplaceListing,
  userId: string | null,
  authLoading: boolean
): MarketplaceListingActionState {
  if (authLoading) {
    return "loading";
  }

  if (!userId) {
    return "login";
  }

  if (listing.sellerId === userId) {
    return "owner";
  }

  return "buy";
}

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

  const itemLabel = useMemo(() => {
    if (marketplace.listings.length === 1) {
      return "1 active listing loaded";
    }
    return `${marketplace.listings.length} loaded${marketplace.total ? ` of ${marketplace.total}` : ""}`;
  }, [marketplace.listings.length, marketplace.total]);

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-slate-950">Marketplace</h1>
          <p className="mt-1 text-sm text-slate-600">Browse active listings and buy cards at listed prices in real time.</p>
        </div>
        <Button variant="secondary" onClick={() => void marketplace.refresh()}>
          Refresh
        </Button>
      </div>

      <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-3">
        <label className="text-sm font-semibold text-slate-700">
          Rarity
          <select
            value={rarity}
            onChange={(event) => setRarity(event.target.value as RarityTier | "")}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500"
          >
            {RARITY_OPTIONS.map((option) => (
              <option key={option.label} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm font-semibold text-slate-700">
          Sort
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as MarketplaceSort)}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-end">
          <p className="text-sm font-semibold text-slate-600">{itemLabel}</p>
        </div>
      </section>

      {marketplace.loading ? <p className="text-sm font-medium text-slate-600">Loading marketplace...</p> : null}
      {marketplace.error ? <p className="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{marketplace.error}</p> : null}

      {!marketplace.loading && !marketplace.error && marketplace.listings.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          No active listings found for this filter.
        </div>
      ) : null}

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
