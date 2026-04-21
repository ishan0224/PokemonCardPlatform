"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { StartAuctionDialog } from "@/components/collection/start-auction-dialog";
import { CardImage } from "@/components/ui/card-image";
import { CardShell } from "@/components/ui/card-shell";
import { Button, buttonClassName } from "@/components/ui/button";
import { formatDollarsInputFromCents, formatMoneyCents, parseDollarsInputToCents } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { AuctionDurationType } from "@/lib/types";
import type { CollectionCard as CollectionCardView } from "@/lib/api-client";

type CollectionCardProps = {
  card: CollectionCardView;
  listingPending: boolean;
  cancelPending: boolean;
  auctionPending: boolean;
  onCreateListing: (cardId: string, price: number) => Promise<void>;
  onCancelListing: (listingId: string) => Promise<void>;
  onStartAuction: (input: {
    card: CollectionCardView;
    startingBid: number;
    durationType: AuctionDurationType;
  }) => Promise<string>;
};

export function CollectionCard({
  card,
  listingPending,
  cancelPending,
  auctionPending,
  onCreateListing,
  onCancelListing,
  onStartAuction
}: CollectionCardProps): JSX.Element {
  const router = useRouter();
  const [priceInput, setPriceInput] = useState(() => formatDollarsInputFromCents(Math.max(card.currentPrice, 50)));
  const [localError, setLocalError] = useState<string | null>(null);
  const [auctionDialogOpen, setAuctionDialogOpen] = useState(false);
  const [auctionSubmitError, setAuctionSubmitError] = useState<string | null>(null);
  const [auctionTriggerElement, setAuctionTriggerElement] = useState<HTMLButtonElement | null>(null);

  const pnlLabel = useMemo(() => {
    const abs = formatMoneyCents(Math.abs(card.pnl));
    return card.pnl >= 0 ? `+${abs}` : `-${abs}`;
  }, [card.pnl]);

  const onSubmitListing = async (): Promise<void> => {
    const parsed = parseDollarsInputToCents(priceInput);
    if (parsed === null || parsed < 50) {
      setLocalError("Listing price must be at least $0.50.");
      return;
    }

    setLocalError(null);
    await onCreateListing(card.id, parsed);
  };

  const onSubmitAuction = async (input: {
    startingBid: number;
    durationType: AuctionDurationType;
  }): Promise<void> => {
    try {
      setAuctionSubmitError(null);
      const auctionId = await onStartAuction({
        card,
        startingBid: input.startingBid,
        durationType: input.durationType
      });
      setAuctionDialogOpen(false);
      router.push(routes.auctions.detail(auctionId));
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Failed to create auction.";
      setAuctionSubmitError(message);
    }
  };

  const header = (
    <div className="flex items-start justify-between gap-2">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-pv-muted">{card.pokemonCard.rarityTier}</p>
        <h3 className="mt-1 text-base font-black text-pv-ink">{card.pokemonCard.name}</h3>
        <p className="text-sm text-pv-muted">{card.pokemonCard.setName}</p>
      </div>
      <span
        className={`rounded-full px-2 py-1 text-xs font-bold uppercase ${
          card.state === "listed"
            ? "bg-amber-100 text-amber-800"
            : card.state === "in_auction"
              ? "bg-indigo-100 text-indigo-800"
              : "bg-emerald-100 text-emerald-800"
        }`}
      >
        {card.state}
      </span>
    </div>
  );

  const media = (
    <div className="flex justify-center">
      <CardImage
        src={card.pokemonCard.imageUrl}
        hiresSrc={card.pokemonCard.imageUrlHires}
        alt={card.pokemonCard.name}
        size="md"
        rarityTier={card.pokemonCard.rarityTier}
      />
    </div>
  );

  const body = (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-lg bg-pv-parchment-soft p-2">
          <p className="text-[11px] uppercase text-pv-muted">Acquired</p>
          <p className="font-bold text-pv-ink">{formatMoneyCents(card.acquisitionPrice)}</p>
        </div>
        <div className="rounded-lg bg-pv-parchment-soft p-2">
          <p className="text-[11px] uppercase text-pv-muted">Market</p>
          <p className="font-bold text-pv-ink">{formatMoneyCents(card.currentPrice)}</p>
        </div>
        <div className={`rounded-lg p-2 ${card.pnl >= 0 ? "bg-emerald-100" : "bg-rose-100"}`}>
          <p className={`text-[11px] uppercase ${card.pnl >= 0 ? "text-emerald-700" : "text-rose-700"}`}>P&amp;L</p>
          <p className={`font-bold ${card.pnl >= 0 ? "text-emerald-900" : "text-rose-900"}`}>{pnlLabel}</p>
        </div>
      </div>

      {card.packId ? (
        <div className="flex items-center justify-between rounded-xl bg-sky-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">Provable Fairness</p>
          <Link href={routes.fairness.verify(card.packId)} className={buttonClassName({ variant: "ghost", size: "sm" })}>
            Verify pack
          </Link>
        </div>
      ) : null}

      {card.state === "owned" ? (
        <div className="space-y-2">
          <label htmlFor={`list-price-${card.id}`} className="text-xs font-semibold uppercase tracking-wide text-pv-muted">
            List Price (USD)
          </label>
          <div className="flex items-center gap-2">
            <input
              id={`list-price-${card.id}`}
              type="number"
              min={0.5}
              step={0.01}
              value={priceInput}
              onChange={(event) => {
                setPriceInput(event.target.value);
                if (localError) {
                  setLocalError(null);
                }
              }}
              className="w-full rounded-xl border border-pv-border px-3 py-2 text-sm font-medium text-pv-ink outline-none ring-0 transition focus:border-pv-accent"
            />
            <Button type="button" loading={listingPending} onClick={() => void onSubmitListing()}>
              {listingPending ? "Listing..." : "List on Marketplace"}
            </Button>
          </div>
          <Button
            type="button"
            variant="secondary"
            fullWidth
            loading={auctionPending}
            onClick={(event) => {
              setAuctionTriggerElement(event.currentTarget);
              setAuctionSubmitError(null);
              setAuctionDialogOpen(true);
            }}
          >
            {auctionPending ? "Starting..." : "Start Auction"}
          </Button>
          {localError ? <p className="text-xs font-semibold text-rose-700">{localError}</p> : null}
        </div>
      ) : null}

      {card.state === "listed" && card.activeListing ? (
        <div className="rounded-xl bg-amber-50 p-3">
          <p className="text-xs uppercase text-amber-700">Active Listing</p>
          <p className="text-sm font-bold text-amber-900">{formatMoneyCents(card.activeListing.price)}</p>
        </div>
      ) : null}
    </div>
  );

  const actions =
    card.state === "listed" && card.activeListing ? (
      <Button
        type="button"
        variant="danger"
        fullWidth
        loading={cancelPending}
        onClick={() => void onCancelListing(card.activeListing!.id)}
      >
        {cancelPending ? "Cancelling..." : "Cancel Listing"}
      </Button>
    ) : undefined;

  return (
    <>
      <CardShell header={header} media={media} body={body} actions={actions} variant="surface" className="min-h-[620px]" />

      {card.state === "owned" ? (
        <StartAuctionDialog
          open={auctionDialogOpen}
          card={card}
          pending={auctionPending}
          submitError={auctionSubmitError}
          triggerElement={auctionTriggerElement}
          onClose={() => {
            setAuctionDialogOpen(false);
            setAuctionSubmitError(null);
          }}
          onSubmit={onSubmitAuction}
        />
      ) : null}
    </>
  );
}
