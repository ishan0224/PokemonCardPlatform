"use client";

import Link from "next/link";
import { memo, useMemo } from "react";
import { CardActions } from "@/components/collection/card-actions";
import { CardImage } from "@/components/ui/card-image";
import { Chip } from "@/components/ui/chip";
import { RarityBadge } from "@/components/ui/rarity-badge";
import { formatMoneyCents } from "@/lib/format";
import { routes } from "@/lib/routes";
import { areCollectionCardPropsEqual, type CollectionCardProps } from "./collection-card-memo";

function CollectionCardComponent({
  card,
  listingPending,
  cancelPending,
  auctionPending,
  onCreateListing,
  onCancelListing,
  onStartAuction
}: CollectionCardProps): JSX.Element {
  const pnlLabel = useMemo(() => {
    const abs = formatMoneyCents(Math.abs(card.pnl));
    return card.pnl >= 0 ? `+${abs}` : `-${abs}`;
  }, [card.pnl]);

  const cardImage = (
    <div className="mb-3 flex justify-center">
      <CardImage
        src={card.pokemonCard.imageUrl}
        hiresSrc={card.pokemonCard.imageUrlHires}
        alt={card.pokemonCard.name}
        size="md"
        rarityTier={card.pokemonCard.rarityTier}
      />
    </div>
  );

  return (
    <article className="flex flex-col rounded-pv-lg border border-pv-line bg-pv-surface-2 p-[14px]">
      {cardImage}

      <div className="flex items-start justify-between gap-2">
        <h3 className="truncate text-[14px] font-bold text-pv-text">{card.pokemonCard.name}</h3>
        <RarityBadge rarity={card.pokemonCard.rarityTier} compact />
      </div>
      <p className="text-[12px] text-pv-muted">{card.pokemonCard.setName}</p>

      {/* META ROWS */}
      <div className="mt-3 space-y-1 text-[13px]">
        {card.state === "listed" && card.activeListing ? (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
                Listed at
              </span>
              <span className="font-extrabold tabular-nums text-pv-text">
                {formatMoneyCents(card.activeListing.price)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
                Market
              </span>
              <span className="text-pv-muted">{formatMoneyCents(card.currentPrice)}</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
                Market
              </span>
              <span
                className={`font-extrabold tabular-nums ${
                  card.pokemonCard.rarityTier === "chase" || card.pokemonCard.rarityTier === "ultra_rare"
                    ? "text-pv-gold"
                    : "text-pv-text"
                }`}
              >
                {formatMoneyCents(card.currentPrice)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
                P&amp;L
              </span>
              <span className={`font-bold ${card.pnl >= 0 ? "text-pv-good" : "text-pv-accent"}`}>
                {pnlLabel}
              </span>
            </div>
          </>
        )}
      </div>

      {/* STATE CHIP (for non-owned) */}
      {card.state !== "owned" ? (
        <div className="mt-3">
          <Chip tone={card.state === "listed" ? "upcoming" : "info"}>
            {card.state === "listed" ? "Listed" : "In auction"}
          </Chip>
        </div>
      ) : null}

      {/* PACK VERIFY */}
      {card.packId ? (
        <div className="mt-3 flex items-center justify-between rounded-pv-sm border border-pv-info/20 bg-[rgba(56,189,248,0.06)] px-2.5 py-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-info">
            Provably fair
          </span>
          <Link
            href={routes.fairness.verify(card.packId)}
            className="text-[11px] font-bold text-pv-info hover:underline"
          >
            Verify →
          </Link>
        </div>
      ) : null}

      {/* ACTIONS */}
      <div className="mt-3 flex-1" />
      <div className="mt-3 space-y-2">
        <CardActions
          card={card}
          listingPending={listingPending}
          cancelPending={cancelPending}
          auctionPending={auctionPending}
          onCreateListing={onCreateListing}
          onCancelListing={onCancelListing}
          onStartAuction={onStartAuction}
          showViewDetailsLink
          viewDetailsHref={routes.collection.detail(card.id)}
        />
      </div>
    </article>
  );
}

export const CollectionCard = memo(CollectionCardComponent, areCollectionCardPropsEqual);
CollectionCard.displayName = "CollectionCard";
