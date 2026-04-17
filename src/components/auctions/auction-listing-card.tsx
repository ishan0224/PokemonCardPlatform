"use client";

import Link from "next/link";
import { formatDateTime, formatMoneyCents } from "@/lib/format";
import type { Auction } from "@/lib/api-client";

type AuctionListingCardProps = {
  auction: Auction;
  currentUserId: string | null;
};

function resolveAuctionRole(auction: Auction, currentUserId: string | null): "owner" | "participant" | "viewer" {
  if (!currentUserId) {
    return "viewer";
  }

  if (auction.sellerId === currentUserId) {
    return "owner";
  }

  if (auction.currentBidderId === currentUserId) {
    return "participant";
  }

  return "viewer";
}

export function AuctionListingCard({ auction, currentUserId }: AuctionListingCardProps): JSX.Element {
  const role = resolveAuctionRole(auction, currentUserId);
  const roleBadgeText = role === "owner" ? "Your Auction" : role === "participant" ? "You Are Leading" : "Live";
  const ctaText = role === "owner" ? "Manage Auction" : role === "participant" ? "View Your Bid" : "Enter Room";

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{auction.card.pokemonCard.rarityTier}</p>
          <h3 className="mt-1 text-base font-black text-slate-900">{auction.card.pokemonCard.name}</h3>
          <p className="text-sm text-slate-600">{auction.card.pokemonCard.setName}</p>
        </div>
        <span className="rounded-full bg-slate-900 px-2 py-1 text-xs font-bold text-white">
          @{auction.sellerUsername}
        </span>
      </div>

      <p
        className={`mt-2 inline-flex rounded-full px-2 py-1 text-[11px] font-bold uppercase ${
          role === "owner"
            ? "bg-amber-100 text-amber-800"
            : role === "participant"
              ? "bg-emerald-100 text-emerald-800"
              : "bg-slate-100 text-slate-700"
        }`}
      >
        {roleBadgeText}
      </p>

      <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-lg bg-slate-100 p-2">
          <p className="text-[11px] uppercase text-slate-500">Current</p>
          <p className="font-bold text-slate-900">{formatMoneyCents(auction.currentBid ?? auction.startingBid)}</p>
        </div>
        <div className="rounded-lg bg-slate-100 p-2">
          <p className="text-[11px] uppercase text-slate-500">Next Min</p>
          <p className="font-bold text-slate-900">{formatMoneyCents(auction.minNextBid)}</p>
        </div>
        <div className="rounded-lg bg-slate-100 p-2">
          <p className="text-[11px] uppercase text-slate-500">Ends</p>
          <p className="font-bold text-slate-900">{formatDateTime(auction.endsAt)}</p>
        </div>
      </div>

      <Link
        href={`/auctions/${auction.id}`}
        className="mt-4 block w-full rounded-xl bg-rose-600 px-3 py-2 text-center text-sm font-bold text-white transition hover:bg-rose-700"
      >
        {ctaText}
      </Link>
    </article>
  );
}
