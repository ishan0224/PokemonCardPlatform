"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CardImage } from "@/components/ui/card-image";
import { CardShell } from "@/components/ui/card-shell";
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

export function MarketplaceListingCard({
  listing,
  actionState,
  isPending,
  onBuy
}: MarketplaceListingCardProps): JSX.Element {
  const delta = listing.card.pokemonCard.currentPrice - listing.price;
  const deltaPositive = delta >= 0;

  const header = (
    <div className="flex items-start justify-between gap-2">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-pv-muted">{listing.card.pokemonCard.rarityTier}</p>
        <h3 className="mt-1 text-base font-black text-pv-ink">{listing.card.pokemonCard.name}</h3>
        <p className="text-sm text-pv-muted">{listing.card.pokemonCard.setName}</p>
      </div>
      <span className="rounded-full bg-pv-ink px-2 py-1 text-xs font-bold uppercase text-white">@{listing.sellerUsername}</span>
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
    <div className="grid grid-cols-3 gap-2 text-sm">
      <div className="rounded-lg bg-pv-parchment-soft p-2">
        <p className="text-[11px] uppercase text-pv-muted">List</p>
        <p className="font-bold text-pv-ink">{formatMoneyCents(listing.price)}</p>
      </div>
      <div className="rounded-lg bg-pv-parchment-soft p-2">
        <p className="text-[11px] uppercase text-pv-muted">Market</p>
        <p className="font-bold text-pv-ink">{formatMoneyCents(listing.card.pokemonCard.currentPrice)}</p>
      </div>
      <div className={`rounded-lg p-2 ${deltaPositive ? "bg-emerald-100" : "bg-rose-100"}`}>
        <p className={`text-[11px] uppercase ${deltaPositive ? "text-emerald-700" : "text-rose-700"}`}>Spread</p>
        <p className={`font-bold ${deltaPositive ? "text-emerald-900" : "text-rose-900"}`}>
          {deltaPositive ? "+" : "-"}
          {formatMoneyCents(Math.abs(delta))}
        </p>
      </div>
    </div>
  );

  const actions =
    actionState === "buy" ? (
      <Button
        type="button"
        fullWidth
        loading={isPending}
        onClick={() => {
          void onBuy(listing.id).catch(() => {
            // Error state is handled by the marketplace hook.
          });
        }}
      >
        {isPending ? "Buying..." : "Buy Now"}
      </Button>
    ) : actionState === "owner" ? (
      <Button type="button" variant="secondary" fullWidth disabled>
        Your Listing
      </Button>
    ) : actionState === "loading" ? (
      <Button type="button" variant="secondary" fullWidth disabled>
        Checking Session...
      </Button>
    ) : (
      <Link href={routes.auth.login} className={buttonClassName({ variant: "secondary", fullWidth: true })}>
        Login to Buy
      </Link>
    );

  return (
    <CardShell header={header} media={media} body={body} actions={actions} variant="surface" className="min-h-[620px]" />
  );
}
