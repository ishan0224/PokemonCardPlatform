import type { AuctionDurationType } from "../../lib/types";
import type { CollectionCard } from "../../lib/api-client";

export type CollectionCardProps = {
  card: CollectionCard;
  listingPending: boolean;
  cancelPending: boolean;
  auctionPending: boolean;
  onCreateListing: (cardId: string, price: number) => Promise<void>;
  onCancelListing: (listingId: string) => Promise<void>;
  onStartAuction: (input: {
    card: CollectionCard;
    startingBid: number;
    durationType: AuctionDurationType;
  }) => Promise<string>;
};

// Memo comparator — SSOT for "is this tile visually current?". Only compares
// fields the render body observes. Two invariants are deliberately not
// compared:
//   1. card.pnl === card.currentPrice - card.acquisitionPrice, and
//      acquisitionPrice is immutable per card. If currentPrice matches, pnl
//      matches.
//   2. card.pokemonCard.* is denormalised from pokemon_cards by FK. For a
//      given card.id those fields are immutable across refetches.
// Anti-tests in __tests__/collection-card.memo.unit.test.ts lock both
// invariants in — if either ever breaks, the anti-tests fail and force this
// comparator to grow accordingly.
export function areCollectionCardPropsEqual(
  prev: CollectionCardProps,
  next: CollectionCardProps
): boolean {
  return (
    prev.card.id === next.card.id &&
    prev.card.currentPrice === next.card.currentPrice &&
    prev.card.state === next.card.state &&
    prev.card.packId === next.card.packId &&
    (prev.card.activeListing?.id ?? null) === (next.card.activeListing?.id ?? null) &&
    (prev.card.activeListing?.price ?? null) === (next.card.activeListing?.price ?? null) &&
    prev.listingPending === next.listingPending &&
    prev.cancelPending === next.cancelPending &&
    prev.auctionPending === next.auctionPending &&
    prev.onCreateListing === next.onCreateListing &&
    prev.onCancelListing === next.onCancelListing &&
    prev.onStartAuction === next.onStartAuction
  );
}
