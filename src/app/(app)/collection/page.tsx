"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CollectionCard } from "@/components/collection/collection-card";
import { CollectionSummary } from "@/components/collection/collection-summary";
import { Button, buttonClassName } from "@/components/ui/button";
import { CardGrid } from "@/components/ui/card-grid";
import { LoadingCardGrid } from "@/components/ui/loading-card-grid";
import { PaginationFooter } from "@/components/ui/pagination-footer";
import { useCollection } from "@/hooks/use-collection";
import { useCreateAuction } from "@/hooks/use-create-auction";
import { useAuth } from "@/hooks/use-auth";
import { routes } from "@/lib/routes";
import type { CardState, RarityTier } from "@/lib/types";
import type { CollectionSort } from "@/lib/api-client";

const RARITY_OPTIONS: Array<{ label: string; value: RarityTier | "" }> = [
  { label: "All Rarities", value: "" },
  { label: "Common", value: "common" },
  { label: "Uncommon", value: "uncommon" },
  { label: "Rare", value: "rare" },
  { label: "Holo Rare", value: "holo_rare" },
  { label: "Ultra Rare", value: "ultra_rare" },
  { label: "Chase", value: "chase" }
];

const STATE_OPTIONS: Array<{ label: string; value: CardState | "" }> = [
  { label: "All States", value: "" },
  { label: "Owned", value: "owned" },
  { label: "Listed", value: "listed" },
  { label: "In Auction", value: "in_auction" }
];

const SORT_OPTIONS: Array<{ label: string; value: CollectionSort }> = [
  { label: "Newest", value: "newest" },
  { label: "Value High-Low", value: "value_desc" },
  { label: "Value Low-High", value: "value_asc" },
  { label: "P&L High-Low", value: "pnl_desc" },
  { label: "P&L Low-High", value: "pnl_asc" }
];

export default function CollectionPage(): JSX.Element {
  const { user, loading: authLoading } = useAuth();
  const [rarity, setRarity] = useState<RarityTier | "">("");
  const [state, setState] = useState<CardState | "">("");
  const [sort, setSort] = useState<CollectionSort>("newest");
  const createAuction = useCreateAuction();

  const collection = useCollection({
    rarity: rarity || null,
    state: state || null,
    sort,
    limit: 24,
    enabled: Boolean(user),
    enableRealtime: Boolean(user)
  });

  const itemLabel = useMemo(() => {
    if (collection.cards.length === 1) {
      return "1 card loaded";
    }
    return `${collection.cards.length} loaded${collection.total ? ` of ${collection.total}` : ""}`;
  }, [collection.cards.length, collection.total]);

  if (authLoading) {
    return <p className="text-sm font-medium text-slate-600">Checking session...</p>;
  }

  if (!authLoading && !user) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-black text-slate-900">Your Collection</h1>
        <p className="mt-2 text-sm text-slate-600">Login to view your cards, list them, and track P&L.</p>
        <Link href={routes.auth.login} className={`${buttonClassName({ variant: "primary" })} mt-4`}>
          Go to Login
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-slate-950">Collection</h1>
          <p className="mt-1 text-sm text-slate-600">
            Manage owned cards, monitor value changes, and list inventory to marketplace.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void collection.refresh()}>
          Refresh
        </Button>
      </div>

      <CollectionSummary portfolio={collection.portfolio} />

      <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-4">
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
          State
          <select
            value={state}
            onChange={(event) => setState(event.target.value as CardState | "")}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500"
          >
            {STATE_OPTIONS.map((option) => (
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
            onChange={(event) => setSort(event.target.value as CollectionSort)}
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

      {collection.loading ? (
        <div className="space-y-3">
          <p className="text-sm font-medium text-slate-600">Loading collection...</p>
          <LoadingCardGrid cards={6} />
        </div>
      ) : null}
      {collection.error ? <p className="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{collection.error}</p> : null}

      {!collection.loading && !collection.error && collection.cards.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          <p className="font-semibold text-slate-900">No cards found for this filter.</p>
          <p className="mt-1">Open packs from drops to add cards to your inventory.</p>
          <Link href={routes.drops.index} className={`${buttonClassName({ variant: "secondary", size: "sm" })} mt-3`}>
            Browse Drops
          </Link>
        </div>
      ) : null}

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
