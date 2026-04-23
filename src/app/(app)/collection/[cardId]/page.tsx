"use client";

import Link from "next/link";
import { useCallback, useMemo } from "react";
import { useSWRConfig } from "swr";
import { CardActions } from "@/components/collection/card-actions";
import { StatusPanel } from "@/components/admin/status-panel";
import { CardImage } from "@/components/ui/card-image";
import { Chip, type ChipTone } from "@/components/ui/chip";
import { RarityBadge } from "@/components/ui/rarity-badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useCollectionCard } from "@/hooks/use-collection-card";
import { useCollectionMutations } from "@/hooks/use-collection-mutations";
import { useCreateAuction } from "@/hooks/use-create-auction";
import { useAuctionsRoom, useMarketplaceRoom, usePortfolioRoom } from "@/hooks/use-socket";
import { formatDateTime, formatMoneyCents } from "@/lib/format";
import { routes } from "@/lib/routes";
import { swrKeys } from "@/lib/swr";
import type { CollectionCardDetail } from "@/lib/api-client";
import type { CollectionCardTransaction } from "@/lib/types";

function mapStateLabel(state: CollectionCardDetail["state"]): string {
  if (state === "listed") {
    return "Listed";
  }
  if (state === "in_auction") {
    return "In auction";
  }
  return "Owned";
}

function mapStateTone(state: CollectionCardDetail["state"]): ChipTone {
  if (state === "listed") {
    return "upcoming";
  }
  if (state === "in_auction") {
    return "info";
  }
  return "good";
}

function formatSignedMoney(value: number): string {
  const abs = formatMoneyCents(Math.abs(value));
  if (value > 0) {
    return `+${abs}`;
  }
  if (value < 0) {
    return `-${abs}`;
  }
  return abs;
}

function formatTransactionType(type: CollectionCardTransaction["type"]): string {
  switch (type) {
    case "pack_purchase":
      return "Pack purchase";
    case "trade_buy":
      return "Trade buy";
    case "trade_sell":
      return "Trade sell";
    case "auction_win":
      return "Auction win";
    case "auction_sell":
      return "Auction sell";
    case "auction_fee":
      return "Auction fee";
    case "trade_fee":
      return "Trade fee";
    default:
      return type;
  }
}

type CollectionDetailPageProps = {
  params: {
    cardId: string;
  };
};

export default function CollectionDetailPage({ params }: CollectionDetailPageProps): JSX.Element {
  const cardId = params.cardId;
  const { mutate } = useSWRConfig();
  const { user, loading: authLoading } = useAuth();
  const cardState = useCollectionCard(cardId, Boolean(user));
  const collectionActions = useCollectionMutations();
  const createAuction = useCreateAuction();
  const card = cardState.card;
  const revalidateCard = useCallback((): void => {
    void mutate(swrKeys.collection.card(cardId));
  }, [cardId, mutate]);

  const handlePortfolioPriceUpdate = useCallback(
    (event: { updates: Array<{ cardId: string }> }): void => {
      if (event.updates.some((update) => update.cardId === cardId)) {
        revalidateCard();
      }
    },
    [cardId, revalidateCard]
  );

  const handlePortfolioConnected = useCallback((): void => {
    revalidateCard();
  }, [revalidateCard]);

  const handleListingCreated = useCallback(
    (event: { cardId: string }): void => {
      if (event.cardId === cardId) {
        revalidateCard();
      }
    },
    [cardId, revalidateCard]
  );

  const handleListingSold = useCallback(
    (event: { cardId: string }): void => {
      if (event.cardId === cardId) {
        revalidateCard();
      }
    },
    [cardId, revalidateCard]
  );

  const handleListingCancelled = useCallback(
    (event: { cardId: string }): void => {
      if (event.cardId === cardId) {
        revalidateCard();
      }
    },
    [cardId, revalidateCard]
  );

  const handleAuctionEnded = useCallback(
    (event: { cardId: string }): void => {
      if (event.cardId === cardId) {
        revalidateCard();
      }
    },
    [cardId, revalidateCard]
  );

  const portfolioRoomHandlers = useMemo(
    () => ({
      onPriceUpdate: handlePortfolioPriceUpdate,
      onConnected: handlePortfolioConnected
    }),
    [handlePortfolioConnected, handlePortfolioPriceUpdate]
  );

  const marketplaceRoomHandlers = useMemo(
    () => ({
      onListingCreated: handleListingCreated,
      onListingSold: handleListingSold,
      onListingCancelled: handleListingCancelled
    }),
    [handleListingCancelled, handleListingCreated, handleListingSold]
  );

  const auctionsRoomHandlers = useMemo(
    () => ({
      onAuctionEnded: handleAuctionEnded
    }),
    [handleAuctionEnded]
  );

  usePortfolioRoom(user?.id ?? null, portfolioRoomHandlers);
  useMarketplaceRoom(Boolean(user), marketplaceRoomHandlers);
  useAuctionsRoom(Boolean(user && card?.activeAuctionId), auctionsRoomHandlers);

  const pnlLabel = useMemo(() => {
    if (!card) {
      return formatMoneyCents(0);
    }
    return formatSignedMoney(card.pnl);
  }, [card]);

  const pnlPercentLabel = useMemo(() => {
    if (!card) {
      return "0.00%";
    }
    const percent = card.pnlPercent * 100;
    const prefix = percent > 0 ? "+" : "";
    return `${prefix}${percent.toFixed(2)}%`;
  }, [card]);

  const trendLabel = useMemo(() => {
    if (!card) {
      return formatMoneyCents(0);
    }
    return formatSignedMoney(card.currentPrice - card.previousPrice);
  }, [card]);

  if (authLoading) {
    return <StatusPanel title="Loading…" message="Checking your session." />;
  }

  if (!user) {
    return (
      <section className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-6">
        <h1 className="text-pv-h2">Card details</h1>
        <p className="mt-2 text-[13px] text-pv-muted">Log in to view details for cards in your collection.</p>
        <Link href={routes.auth.login} className={`${buttonClassName({ variant: "primary" })} mt-4`}>
          Go to login
        </Link>
      </section>
    );
  }

  if (cardState.loading && !card) {
    return <StatusPanel title="Loading card…" message="Fetching card details." />;
  }

  if (!card) {
    const message =
      cardState.error && cardState.error.length > 0
        ? cardState.error
        : "This card is not in your collection.";
    return (
      <StatusPanel
        title="Card not found"
        message={message}
        action={{ label: "Back to collection", href: routes.collection.index }}
      />
    );
  }

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={routes.collection.index} className="text-[12px] font-bold text-pv-muted hover:text-pv-text">
            ← Back to collection
          </Link>
          <h1 className="mt-1 text-pv-h2">{card.pokemonCard.name}</h1>
          <p className="mt-1 text-[13px] text-pv-muted">{card.pokemonCard.setName}</p>
        </div>
        <Chip tone={mapStateTone(card.state)}>{mapStateLabel(card.state)}</Chip>
      </header>

      <section className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[272px_1fr]">
        <div className="flex justify-center rounded-pv-lg border border-pv-line bg-pv-surface-2 p-4 lg:self-start">
          <CardImage
            src={card.pokemonCard.imageUrl}
            hiresSrc={card.pokemonCard.imageUrlHires}
            alt={card.pokemonCard.name}
            size="xl"
            priority
            rarityTier={card.pokemonCard.rarityTier}
          />
        </div>

        <div className="space-y-4 rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <RarityBadge rarity={card.pokemonCard.rarityTier} />
            <Chip tone="neutral">TCG #{card.pokemonCard.tcgId}</Chip>
            <Chip tone="neutral">Acquired {formatDateTime(card.acquiredAtIso)}</Chip>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-pv-sm border border-pv-line bg-pv-surface-3 p-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">Current</p>
              <p className="mt-1 text-[18px] font-extrabold text-pv-text">{formatMoneyCents(card.currentPrice)}</p>
            </div>
            <div className="rounded-pv-sm border border-pv-line bg-pv-surface-3 p-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">Previous</p>
              <p className="mt-1 text-[18px] font-extrabold text-pv-text">{formatMoneyCents(card.previousPrice)}</p>
              <p className="mt-1 text-[11px] text-pv-muted">Δ {trendLabel}</p>
            </div>
            <div className="rounded-pv-sm border border-pv-line bg-pv-surface-3 p-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">Acquisition</p>
              <p className="mt-1 text-[18px] font-extrabold text-pv-text">
                {formatMoneyCents(card.acquisitionPrice)}
              </p>
            </div>
            <div className="rounded-pv-sm border border-pv-line bg-pv-surface-3 p-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">P&amp;L</p>
              <p className={`mt-1 text-[18px] font-extrabold ${card.pnl >= 0 ? "text-pv-good" : "text-pv-accent"}`}>
                {pnlLabel}
              </p>
              <p className="mt-1 text-[11px] text-pv-muted">{pnlPercentLabel}</p>
            </div>
          </div>

          <div className="rounded-pv-sm border border-pv-line bg-pv-surface-3 p-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">Lineage</p>
            <div className="mt-2 space-y-1 text-[13px] text-pv-muted">
              <p>Drop: {card.lineage.dropName ?? "n/a"}</p>
              <p className="font-mono text-[12px] text-pv-muted-2">Drop ID: {card.lineage.dropId ?? "n/a"}</p>
              <p>Pack tier: {card.lineage.packTier ?? "n/a"}</p>
              <p className="font-mono text-[12px] text-pv-muted-2">Pack ID: {card.lineage.packId ?? "n/a"}</p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {card.packId ? (
                <Link
                  href={routes.fairness.verify(card.packId)}
                  className={buttonClassName({ variant: "ghost", size: "sm" })}
                >
                  Verify pack
                </Link>
              ) : null}
              {card.activeAuctionId ? (
                <Link
                  href={routes.auctions.detail(card.activeAuctionId)}
                  className={buttonClassName({ variant: "secondary", size: "sm" })}
                >
                  Go to auction room
                </Link>
              ) : null}
            </div>
          </div>

          <div className="rounded-pv-sm border border-pv-line bg-pv-surface-3 p-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">Actions</p>
            <div className="mt-3">
              <CardActions
                card={card}
                listingPending={collectionActions.listingPendingCardId === card.id}
                cancelPending={collectionActions.cancelPendingListingId === card.activeListing?.id}
                auctionPending={createAuction.pendingCardId === card.id}
                onCreateListing={collectionActions.createListing}
                onCancelListing={collectionActions.cancelListing}
                onStartAuction={createAuction.createAuction}
              />
            </div>
          </div>

          {collectionActions.error ? (
            <p role="alert" className="text-[12px] font-semibold text-pv-accent">
              {collectionActions.error}
            </p>
          ) : null}
        </div>
      </section>

      <section className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-bold text-pv-text">Related transactions</h2>
          <Button variant="secondary" size="sm" onClick={() => void cardState.refresh()}>
            Refresh
          </Button>
        </div>

        {card.transactions.length === 0 ? (
          <p className="mt-3 text-[13px] text-pv-muted">No related transactions for this card yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-pv-line">
            {card.transactions.map((transaction) => (
              <li key={transaction.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                <div>
                  <p className="font-semibold text-pv-text">{formatTransactionType(transaction.type)}</p>
                  <p className="text-[12px] text-pv-muted">{formatDateTime(transaction.createdAtIso)}</p>
                </div>
                <p
                  className={`font-bold ${
                    transaction.amount > 0
                      ? "text-pv-good"
                      : transaction.amount < 0
                        ? "text-pv-accent"
                        : "text-pv-muted"
                  }`}
                >
                  {formatSignedMoney(transaction.amount)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
