"use client";

import { MarketplaceListingCard } from "@/components/marketplace/marketplace-listing-card";
import { CardGrid } from "@/components/ui/card-grid";
import type { MarketplaceListing } from "@/lib/api-client";

type GuestMarketplaceGridProps = {
  listings: MarketplaceListing[];
};

async function guestBuyNoop(): Promise<void> {
  // Guests cannot purchase from the home page; `actionState` is always "login",
  // which renders a sign-in link instead of firing the buy handler.
}

export function GuestMarketplaceGrid({ listings }: GuestMarketplaceGridProps): JSX.Element {
  return (
    <CardGrid
      items={listings}
      ariaLabel="Marketplace listings preview"
      itemKey={(listing) => listing.id}
      renderItem={(listing) => (
        <MarketplaceListingCard
          listing={listing}
          actionState="login"
          isPending={false}
          onBuy={guestBuyNoop}
        />
      )}
    />
  );
}
