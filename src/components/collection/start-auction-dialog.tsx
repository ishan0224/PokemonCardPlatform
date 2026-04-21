"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatDollarsInputFromCents, formatMoneyCents, parseDollarsInputToCents } from "@/lib/format";
import type { CollectionCard } from "@/lib/api-client";
import type { AuctionDurationType } from "@/lib/types";

const MIN_STARTING_BID_CENTS = 50;

const DURATION_OPTIONS: Array<{ label: string; value: AuctionDurationType }> = [
  { label: "1 hour", value: "1h" },
  { label: "6 hours", value: "6h" },
  { label: "24 hours", value: "24h" }
];

type StartAuctionDialogProps = {
  open: boolean;
  card: CollectionCard;
  pending: boolean;
  submitError: string | null;
  triggerElement: HTMLButtonElement | null;
  onClose: () => void;
  onSubmit: (input: { startingBid: number; durationType: AuctionDurationType }) => Promise<void>;
};

export function StartAuctionDialog({
  open,
  card,
  pending,
  submitError,
  triggerElement,
  onClose,
  onSubmit
}: StartAuctionDialogProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [startingBidInput, setStartingBidInput] = useState("");
  const [durationType, setDurationType] = useState<AuctionDurationType>("1h");
  const [localValidationError, setLocalValidationError] = useState<string | null>(null);

  const debouncedStartingBidInput = useDebouncedValue(startingBidInput, 300);

  useEffect(() => {
    if (!open) {
      return;
    }

    const defaultBid = Math.max(card.currentPrice, MIN_STARTING_BID_CENTS);
    setStartingBidInput(formatDollarsInputFromCents(defaultBid));
    setDurationType("1h");
    setLocalValidationError(null);
  }, [card.currentPrice, card.id, open]);

  const debouncedValidationError = useMemo(() => {
    const parsed = parseDollarsInputToCents(debouncedStartingBidInput);
    if (parsed === null || parsed < MIN_STARTING_BID_CENTS) {
      return "Starting bid must be at least $0.50.";
    }

    return null;
  }, [debouncedStartingBidInput]);

  const effectiveError = localValidationError ?? debouncedValidationError ?? submitError;

  const onSubmitForm = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    const parsed = parseDollarsInputToCents(startingBidInput);
    if (parsed === null || parsed < MIN_STARTING_BID_CENTS) {
      setLocalValidationError("Starting bid must be at least $0.50.");
      return;
    }

    setLocalValidationError(null);
    await onSubmit({ startingBid: parsed, durationType });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Start Auction"
      description={`Create an auction for ${card.pokemonCard.name}.`}
      initialFocusRef={inputRef}
      restoreFocusElement={triggerElement}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={`start-auction-form-${card.id}`} loading={pending}>
            {pending ? "Starting..." : "Start Auction"}
          </Button>
        </>
      }
    >
      <form id={`start-auction-form-${card.id}`} onSubmit={(event) => void onSubmitForm(event)} className="space-y-3">
        <div className="rounded-xl bg-pv-parchment-soft p-3 text-sm">
          <p className="text-xs uppercase text-pv-muted">Current Market</p>
          <p className="font-bold text-pv-ink">{formatMoneyCents(card.currentPrice)}</p>
        </div>

        <label htmlFor={`auction-starting-bid-${card.id}`} className="block text-xs font-semibold uppercase tracking-wide text-pv-muted">
          Starting Bid (USD)
        </label>
        <input
          ref={inputRef}
          id={`auction-starting-bid-${card.id}`}
          type="number"
          min={0.5}
          step={0.01}
          value={startingBidInput}
          onChange={(event) => {
            setStartingBidInput(event.target.value);
            if (localValidationError) {
              setLocalValidationError(null);
            }
          }}
          className="w-full rounded-xl border border-pv-border px-3 py-2 text-sm font-medium text-pv-ink outline-none ring-0 transition focus:border-pv-accent"
        />

        <label htmlFor={`auction-duration-${card.id}`} className="block text-xs font-semibold uppercase tracking-wide text-pv-muted">
          Duration
        </label>
        <select
          id={`auction-duration-${card.id}`}
          value={durationType}
          onChange={(event) => setDurationType(event.target.value as AuctionDurationType)}
          className="w-full rounded-xl border border-pv-border px-3 py-2 text-sm font-medium text-pv-ink outline-none ring-0 transition focus:border-pv-accent"
        >
          {DURATION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {effectiveError ? (
          <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
            ! {effectiveError}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
