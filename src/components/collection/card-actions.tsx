"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, buttonClassName } from "@/components/ui/button";
import { formatDollarsInputFromCents, parseDollarsInputToCents } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { CollectionCard } from "@/lib/api-client";
import type { AuctionDurationType } from "@/lib/types";

type CardActionsProps = {
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
  showViewDetailsLink?: boolean;
  viewDetailsHref?: string;
};

type InlineForm = "none" | "list" | "auction";

const DURATION_OPTIONS: Array<{ value: AuctionDurationType; label: string }> = [
  { value: "1h", label: "1h" },
  { value: "6h", label: "6h" },
  { value: "24h", label: "24h" }
];

const MIN_LISTING_CENTS = 50;
const MIN_STARTING_BID_CENTS = 50;

export function CardActions({
  card,
  listingPending,
  cancelPending,
  auctionPending,
  onCreateListing,
  onCancelListing,
  onStartAuction,
  showViewDetailsLink = false,
  viewDetailsHref
}: CardActionsProps): JSX.Element {
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

  useEffect(() => {
    if (inlineForm !== "none") {
      return;
    }

    setPriceInput(formatDollarsInputFromCents(Math.max(card.currentPrice, MIN_LISTING_CENTS)));
    setBidInput(formatDollarsInputFromCents(Math.max(card.currentPrice, MIN_STARTING_BID_CENTS)));
  }, [card.currentPrice, inlineForm]);

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

  return (
    <div className="space-y-2">
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

      {card.state === "owned" && inlineForm === "auction" ? (
        <>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">Duration</span>
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

      {card.state === "in_auction" ? (
        <Button type="button" variant="secondary" size="md" fullWidth disabled>
          In auction
        </Button>
      ) : null}

      {showViewDetailsLink ? (
        <Link
          href={viewDetailsHref ?? routes.collection.detail(card.id)}
          className={`${buttonClassName({ variant: "ghost", size: "sm", fullWidth: true })} text-center`}
        >
          View details →
        </Link>
      ) : null}

      {localError ? (
        <p role="alert" className="text-[11px] font-semibold text-pv-accent">
          {localError}
        </p>
      ) : null}
    </div>
  );
}
