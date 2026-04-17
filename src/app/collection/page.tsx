"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CollectionCard } from "@/components/collection/collection-card";
import { CollectionSummary } from "@/components/collection/collection-summary";
import { useCollection } from "@/hooks/use-collection";
import { useAuth } from "@/hooks/use-auth";
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
  const { user } = useAuth();
  const [rarity, setRarity] = useState<RarityTier | "">("");
  const [state, setState] = useState<CardState | "">("");
  const [sort, setSort] = useState<CollectionSort>("newest");

  const collection = useCollection({
    rarity: rarity || null,
    state: state || null,
    sort,
    page: 1,
    limit: 24,
    enabled: Boolean(user),
    enableRealtime: Boolean(user)
  });

  const itemLabel = useMemo(() => {
    if (collection.total === 1) {
      return "1 card";
    }
    return `${collection.total} cards`;
  }, [collection.total]);

  if (!user) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-black text-slate-900">Your Collection</h1>
        <p className="mt-2 text-sm text-slate-600">Login to view your cards, list them, and track P&L.</p>
        <Link
          href="/login"
          className="mt-4 inline-flex rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-700"
        >
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
        <button
          type="button"
          onClick={() => void collection.refresh()}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500 hover:bg-slate-50"
        >
          Refresh
        </button>
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

      {collection.loading ? <p className="text-sm font-medium text-slate-600">Loading collection...</p> : null}
      {collection.error ? <p className="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{collection.error}</p> : null}

      {!collection.loading && !collection.error && collection.cards.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          No cards found for this filter.
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {collection.cards.map((card) => (
          <CollectionCard
            key={card.id}
            card={card}
            listingPending={collection.listingPendingCardId === card.id}
            cancelPending={collection.cancelPendingListingId === card.activeListing?.id}
            onCreateListing={collection.createListing}
            onCancelListing={collection.cancelListing}
          />
        ))}
      </div>
    </section>
  );
}
