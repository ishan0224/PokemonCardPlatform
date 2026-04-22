"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CardImage } from "@/components/ui/card-image";
import { Button, buttonClassName } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { RarityBadge } from "@/components/ui/rarity-badge";
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

type InlineForm = "none" | "list" | "auction";

const DURATION_OPTIONS: Array<{ value: AuctionDurationType; label: string }> = [
  { value: "1h", label: "1h" },
  { value: "6h", label: "6h" },
  { value: "24h", label: "24h" }
];

const MIN_LISTING_CENTS = 50;
const MIN_STARTING_BID_CENTS = 50;

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
  const [inlineForm, setInlineForm] = useState<InlineForm>("none");
  const [priceInput, setPriceInput] = useState(() =>
    formatDollarsInputFromCents(Math.max(card.currentPrice, MIN_LISTING_CENTS))
  );
  const [bidInput, setBidInput] = useState(() =>
    formatDollarsInputFromCents(Math.max(card.currentPrice, MIN_STARTING_BID_CENTS))
  );
  const [durationType, setDurationType] = useState<AuctionDurationType>("1h");
  const [localError, setLocalError] = useState<string | null>(null);

  const pnlLabel = useMemo(() => {
    const abs = formatMoneyCents(Math.abs(card.pnl));
    return card.pnl >= 0 ? `+${abs}` : `-${abs}`;
  }, [card.pnl]);

  const closeInlineForm = (): void => {
    setInlineForm("none");
    setLocalError(null);
  };

  const onSubmitListing = async (): Promise<void> => {
    const parsed = parseDollarsInputToCents(priceInput);
    if (parsed === null || parsed < MIN_LISTING_CENTS) {
      setLocalError("Listing price must be at least $0.50.");
      return;
    }
    setLocalError(null);
    try {
      await onCreateListing(card.id, parsed);
      setInlineForm("none");
    } catch (caughtError) {
      setLocalError(caughtError instanceof Error ? caughtError.message : "Failed to list card.");
    }
  };

  const onSubmitAuction = async (): Promise<void> => {
    const parsed = parseDollarsInputToCents(bidInput);
    if (parsed === null || parsed < MIN_STARTING_BID_CENTS) {
      setLocalError("Starting bid must be at least $0.50.");
      return;
    }
    setLocalError(null);
    try {
      const auctionId = await onStartAuction({ card, startingBid: parsed, durationType });
      setInlineForm("none");
      router.push(routes.auctions.detail(auctionId));
    } catch (caughtError) {
      setLocalError(caughtError instanceof Error ? caughtError.message : "Failed to create auction.");
    }
  };

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
        {/* OWNED: default dual-button; inline form on click */}
        {card.state === "owned" && inlineForm === "none" ? (
          <div className="flex gap-1.5">
            <Button
              type="button"
              variant="primary"
              size="md"
              className="flex-1"
              onClick={() => {
                setLocalError(null);
                setInlineForm("list");
              }}
            >
              List
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="md"
              className="flex-1"
              onClick={() => {
                setLocalError(null);
                setInlineForm("auction");
              }}
            >
              Auction
            </Button>
          </div>
        ) : null}

        {/* OWNED · LIST INLINE FORM */}
        {card.state === "owned" && inlineForm === "list" ? (
          <>
            <div className="flex items-center justify-between">
              <label
                htmlFor={`list-price-${card.id}`}
                className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted-2"
              >
                List price (USD)
              </label>
              <button
                type="button"
                onClick={closeInlineForm}
                aria-label="Cancel listing form"
                className="text-[11px] text-pv-muted hover:text-pv-text"
              >
                ✕ cancel
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                id={`list-price-${card.id}`}
                type="number"
                min={0.5}
                step={0.01}
                value={priceInput}
                onChange={(event) => {
                  setPriceInput(event.target.value);
                  if (localError) setLocalError(null);
                }}
                className="min-h-10 basis-3/4 rounded-[10px] border border-pv-line bg-pv-surface-3 px-3 py-2 text-[13px] font-semibold text-pv-text outline-none transition focus:border-pv-line-strong focus:ring-[3px] focus:ring-pv-gold/10"
              />
              <Button
                type="button"
                variant="primary"
                size="md"
                className="basis-1/4"
                loading={listingPending}
                onClick={() => void onSubmitListing()}
              >
                List
              </Button>
            </div>
          </>
        ) : null}

        {/* OWNED · AUCTION INLINE FORM */}
        {card.state === "owned" && inlineForm === "auction" ? (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
                Duration
              </span>
              <button
                type="button"
                onClick={closeInlineForm}
                aria-label="Cancel auction form"
                className="text-[11px] text-pv-muted hover:text-pv-text"
              >
                ✕ cancel
              </button>
            </div>
            <div
              role="radiogroup"
              aria-label="Auction duration"
              className="inline-flex gap-0.5 rounded-[10px] border border-pv-line bg-pv-surface-3 p-[3px]"
            >
              {DURATION_OPTIONS.map((opt) => {
                const active = opt.value === durationType;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setDurationType(opt.value)}
                    className={`rounded-[7px] px-3 py-1 text-[11px] font-bold transition-colors ${
                      active ? "bg-pv-surface-4 text-pv-text" : "text-pv-muted hover:text-pv-text"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <label
              htmlFor={`auction-bid-${card.id}`}
              className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted-2"
            >
              Starting bid (USD)
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id={`auction-bid-${card.id}`}
                type="number"
                min={0.5}
                step={0.01}
                value={bidInput}
                onChange={(event) => {
                  setBidInput(event.target.value);
                  if (localError) setLocalError(null);
                }}
                className="min-h-10 basis-3/4 rounded-[10px] border border-pv-line bg-pv-surface-3 px-3 py-2 text-[13px] font-semibold text-pv-text outline-none transition focus:border-pv-line-strong focus:ring-[3px] focus:ring-pv-gold/10"
              />
              <Button
                type="button"
                variant="secondary"
                size="md"
                className="basis-1/4"
                loading={auctionPending}
                onClick={() => void onSubmitAuction()}
              >
                Start
              </Button>
            </div>
          </>
        ) : null}

        {/* LISTED · cancel listing */}
        {card.state === "listed" && card.activeListing ? (
          <Button
            type="button"
            variant="danger"
            size="md"
            fullWidth
            loading={cancelPending}
            onClick={() => void onCancelListing(card.activeListing!.id)}
          >
            {cancelPending ? "Cancelling…" : "Cancel listing"}
          </Button>
        ) : null}

        {/* IN_AUCTION · no actions (auction is running) */}
        {card.state === "in_auction" ? (
          <Button type="button" variant="secondary" size="md" fullWidth disabled>
            In auction
          </Button>
        ) : null}

        {localError ? (
          <p role="alert" className="text-[11px] font-semibold text-pv-accent">
            {localError}
          </p>
        ) : null}
      </div>
    </article>
  );
}
