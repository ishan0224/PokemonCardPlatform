"use client";

import Link from "next/link";
import { CardImage } from "@/components/ui/card-image";
import { CardShell } from "@/components/ui/card-shell";
import { buttonClassName } from "@/components/ui/button-styles";
import { formatDateTime, formatMoneyCents } from "@/lib/format";
import { routes } from "@/lib/routes";
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

  const header = (
    <div className="flex items-start justify-between gap-2">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-pv-muted">{auction.card.pokemonCard.rarityTier}</p>
        <h3 className="mt-1 text-base font-black text-pv-ink">{auction.card.pokemonCard.name}</h3>
        <p className="text-sm text-pv-muted">{auction.card.pokemonCard.setName}</p>
      </div>
      <span className="rounded-full bg-pv-ink px-2 py-1 text-xs font-bold text-white">@{auction.sellerUsername}</span>
    </div>
  );

  const media = (
    <div className="flex justify-center">
      <CardImage
        src={auction.card.pokemonCard.imageUrl}
        hiresSrc={auction.card.pokemonCard.imageUrlHires}
        alt={auction.card.pokemonCard.name}
        size="md"
        rarityTier={auction.card.pokemonCard.rarityTier}
      />
    </div>
  );

  const body = (
    <div className="space-y-3">
      <p
        className={`inline-flex rounded-full px-2 py-1 text-[11px] font-bold uppercase ${
          role === "owner"
            ? "bg-amber-100 text-amber-800"
            : role === "participant"
              ? "bg-emerald-100 text-emerald-800"
              : "bg-pv-parchment-soft text-pv-muted"
        }`}
      >
        {roleBadgeText}
      </p>

      <div className="grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-lg bg-pv-parchment-soft p-2">
          <p className="text-[11px] uppercase text-pv-muted">Current</p>
          <p className="font-bold text-pv-ink">{formatMoneyCents(auction.currentBid ?? auction.startingBid)}</p>
        </div>
        <div className="rounded-lg bg-pv-parchment-soft p-2">
          <p className="text-[11px] uppercase text-pv-muted">Next Min</p>
          <p className="font-bold text-pv-ink">{formatMoneyCents(auction.minNextBid)}</p>
        </div>
        <div className="rounded-lg bg-pv-parchment-soft p-2">
          <p className="text-[11px] uppercase text-pv-muted">Ends</p>
          <p className="font-bold text-pv-ink">{formatDateTime(auction.endsAt)}</p>
        </div>
      </div>
    </div>
  );

  const actions = (
    <Link href={routes.auctions.detail(auction.id)} className={buttonClassName({ variant: "primary", fullWidth: true })}>
      {ctaText}
    </Link>
  );

  return (
    <CardShell header={header} media={media} body={body} actions={actions} variant="surface" className="min-h-[620px]" />
  );
}
