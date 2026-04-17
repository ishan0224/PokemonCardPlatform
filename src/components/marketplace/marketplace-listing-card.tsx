"use client";

import Link from "next/link";
import { formatMoneyCents } from "@/lib/format";
import type { MarketplaceListing } from "@/lib/api-client";

export type MarketplaceListingActionState = "buy" | "login" | "owner";

type MarketplaceListingCardProps = {
  listing: MarketplaceListing;
  actionState: MarketplaceListingActionState;
  isPending: boolean;
  onBuy: (listingId: string) => Promise<void>;
};

export function MarketplaceListingCard({
  listing,
  actionState,
  isPending,
  onBuy
}: MarketplaceListingCardProps): JSX.Element {
  const delta = listing.card.pokemonCard.currentPrice - listing.price;
  const deltaPositive = delta >= 0;

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{listing.card.pokemonCard.rarityTier}</p>
          <h3 className="mt-1 text-base font-black text-slate-900">{listing.card.pokemonCard.name}</h3>
          <p className="text-sm text-slate-600">{listing.card.pokemonCard.setName}</p>
        </div>
        <span className="rounded-full bg-slate-900 px-2 py-1 text-xs font-bold uppercase text-white">
          @{listing.sellerUsername}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-lg bg-slate-100 p-2">
          <p className="text-[11px] uppercase text-slate-500">List</p>
          <p className="font-bold text-slate-900">{formatMoneyCents(listing.price)}</p>
        </div>
        <div className="rounded-lg bg-slate-100 p-2">
          <p className="text-[11px] uppercase text-slate-500">Market</p>
          <p className="font-bold text-slate-900">{formatMoneyCents(listing.card.pokemonCard.currentPrice)}</p>
        </div>
        <div className={`rounded-lg p-2 ${deltaPositive ? "bg-emerald-100" : "bg-rose-100"}`}>
          <p className={`text-[11px] uppercase ${deltaPositive ? "text-emerald-700" : "text-rose-700"}`}>Spread</p>
          <p className={`font-bold ${deltaPositive ? "text-emerald-900" : "text-rose-900"}`}>
            {deltaPositive ? "+" : "-"}
            {formatMoneyCents(Math.abs(delta))}
          </p>
        </div>
      </div>

      <div className="mt-4">
        {actionState === "buy" ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              void onBuy(listing.id).catch(() => {
                // Error state is handled by the marketplace hook.
              });
            }}
            className={`w-full rounded-xl px-3 py-2 text-sm font-bold transition ${
              isPending ? "cursor-not-allowed bg-slate-200 text-slate-500" : "bg-rose-600 text-white hover:bg-rose-700"
            }`}
          >
            {isPending ? "Buying..." : "Buy Now"}
          </button>
        ) : actionState === "owner" ? (
          <button
            type="button"
            disabled
            className="w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-bold text-slate-500"
          >
            Your Listing
          </button>
        ) : (
          <Link
            href="/login"
            className="block w-full rounded-xl border border-slate-300 px-3 py-2 text-center text-sm font-bold text-slate-700 transition hover:border-slate-900 hover:text-slate-900"
          >
            Login to Buy
          </Link>
        )}
      </div>
    </article>
  );
}
