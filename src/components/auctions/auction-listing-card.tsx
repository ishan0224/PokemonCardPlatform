"use client";

import Link from "next/link";
import { CardImage } from "@/components/ui/card-image";
import { CardShell } from "@/components/ui/card-shell";
import { Chip } from "@/components/ui/chip";
import { RarityBadge } from "@/components/ui/rarity-badge";
import { buttonClassName } from "@/components/ui/button-styles";
import { formatDateTime, formatMoneyCents } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { Auction } from "@/lib/api-client";

type AuctionListingCardProps = {
  auction: Auction;
  currentUserId: string | null;
};

function resolveRole(auction: Auction, uid: string | null): "owner" | "leading" | "viewer" {
  if (!uid) return "viewer";
  if (auction.sellerId === uid) return "owner";
  if (auction.currentBidderId === uid) return "leading";
  return "viewer";
}

export function AuctionListingCard({ auction, currentUserId }: AuctionListingCardProps): JSX.Element {
  const role = resolveRole(auction, currentUserId);
  const isChase = auction.card.pokemonCard.rarityTier === "chase";

  const cta =
    role === "owner" ? "Manage auction" : role === "leading" ? "View your bid" : "Enter room";

  const header = (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="truncate text-[14px] font-bold text-pv-text">{auction.card.pokemonCard.name}</h3>
        <p className="mt-0.5 truncate text-[12px] text-pv-muted">
          {auction.card.pokemonCard.setName} · @{auction.sellerUsername}
        </p>
      </div>
      <RarityBadge rarity={auction.card.pokemonCard.rarityTier} compact />
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
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-pv-muted">Current bid</p>
          <p
            className={`text-[20px] font-extrabold tabular-nums ${
              role === "leading" ? "text-pv-gold" : "text-pv-text"
            }`}
          >
            {formatMoneyCents(auction.currentBid ?? auction.startingBid)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wide text-pv-muted">Ends</p>
          <p className="text-[13px] font-bold text-pv-text">{formatDateTime(auction.endsAt)}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        {role === "leading" ? (
          <Chip tone="good">You lead</Chip>
        ) : role === "owner" ? (
          <Chip tone="gold">Your auction</Chip>
        ) : (
          <Chip tone="live" pulse>
            Live
          </Chip>
        )}
        <span className="text-[11px] tabular-nums text-pv-muted">
          Next min {formatMoneyCents(auction.minNextBid)}
        </span>
      </div>
    </div>
  );

  const actions = (
    <Link
      href={routes.auctions.detail(auction.id)}
      className={buttonClassName({
        variant: isChase ? "gold" : "primary",
        fullWidth: true
      })}
    >
      {cta}
    </Link>
  );

  return (
    <CardShell
      header={header}
      media={media}
      body={body}
      actions={actions}
      variant="surface"
      tone={isChase ? "rarity-chase" : "default"}
      className="min-h-[580px]"
    />
  );
}
