"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CardImage } from "@/components/ui/card-image";
import { CardShell } from "@/components/ui/card-shell";
import { RarityBadge } from "@/components/ui/rarity-badge";
import { buttonClassName } from "@/components/ui/button-styles";
import { formatMoneyCents } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { MarketplaceListing } from "@/lib/api-client";

export type MarketplaceListingActionState = "buy" | "login" | "owner" | "loading";

type MarketplaceListingCardProps = {
  listing: MarketplaceListing;
  actionState: MarketplaceListingActionState;
  isPending: boolean;
  onBuy: (listingId: string) => Promise<void>;
};

function spreadTone(listCents: number, marketCents: number): "good" | "bad" | "muted" {
  if (marketCents <= 0) return "muted";
  const ratio = (marketCents - listCents) / marketCents;
  if (ratio >= 0.05) return "good";
  if (ratio <= -0.05) return "bad";
  return "muted";
}

export function MarketplaceListingCard({
  listing,
  actionState,
  isPending,
  onBuy
}: MarketplaceListingCardProps): JSX.Element {
  const marketCents = listing.card.pokemonCard.currentPrice;
  const tone = spreadTone(listing.price, marketCents);
  const isChase = listing.card.pokemonCard.rarityTier === "chase";
  const deltaPct = marketCents > 0 ? ((marketCents - listing.price) / marketCents) * 100 : 0;
  const deltaLabel =
    tone === "good"
      ? `▾ ${deltaPct.toFixed(1)}% below`
      : tone === "bad"
        ? `▴ ${Math.abs(deltaPct).toFixed(1)}% above`
        : "≈ market";

  const header = (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="truncate text-[14px] font-bold text-pv-text">{listing.card.pokemonCard.name}</h3>
        <p className="mt-0.5 truncate text-[12px] text-pv-muted">
          {listing.card.pokemonCard.setName} · @{listing.sellerUsername}
        </p>
      </div>
      <RarityBadge rarity={listing.card.pokemonCard.rarityTier} compact />
    </div>
  );

  const media = (
    <div className="flex justify-center">
      <CardImage
        src={listing.card.pokemonCard.imageUrl}
        hiresSrc={listing.card.pokemonCard.imageUrlHires}
        alt={listing.card.pokemonCard.name}
        size="md"
        rarityTier={listing.card.pokemonCard.rarityTier}
      />
    </div>
  );

  const body = (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-pv-muted">List</span>
        <span className="font-extrabold tabular-nums text-pv-text">{formatMoneyCents(listing.price)}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-pv-muted">Market</span>
        <span
          className={`text-[12px] font-bold tabular-nums ${
            tone === "good" ? "text-pv-good" : tone === "bad" ? "text-pv-accent" : "text-pv-muted"
          }`}
        >
          {formatMoneyCents(marketCents)} · {deltaLabel}
        </span>
      </div>
    </div>
  );

  const actions =
    actionState === "buy" ? (
      <Button
        type="button"
        variant={isChase ? "gold" : "primary"}
        fullWidth
        loading={isPending}
        onClick={() => {
          void onBuy(listing.id).catch(() => {
            // handled upstream
          });
        }}
      >
        {isPending ? "Buying…" : "Buy now"}
      </Button>
    ) : actionState === "owner" ? (
      <Button type="button" variant="secondary" fullWidth disabled>
        Your listing
      </Button>
    ) : actionState === "loading" ? (
      <Button type="button" variant="secondary" fullWidth disabled>
        Checking session…
      </Button>
    ) : (
      <Link
        href={routes.auth.login}
        className={buttonClassName({ variant: "secondary", fullWidth: true })}
      >
        Log in to buy
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
      className="min-h-[560px]"
    />
  );
}
