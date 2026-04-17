"use client";

import { useMemo, useState } from "react";
import { formatDollarsInputFromCents, formatMoneyCents, parseDollarsInputToCents } from "@/lib/format";
import type { CollectionCard as CollectionCardView } from "@/lib/api-client";

type CollectionCardProps = {
  card: CollectionCardView;
  listingPending: boolean;
  cancelPending: boolean;
  onCreateListing: (cardId: string, price: number) => Promise<void>;
  onCancelListing: (listingId: string) => Promise<void>;
};

export function CollectionCard({
  card,
  listingPending,
  cancelPending,
  onCreateListing,
  onCancelListing
}: CollectionCardProps): JSX.Element {
  const [priceInput, setPriceInput] = useState(() => formatDollarsInputFromCents(Math.max(card.currentPrice, 50)));
  const [localError, setLocalError] = useState<string | null>(null);

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

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{card.pokemonCard.rarityTier}</p>
          <h3 className="mt-1 text-base font-black text-slate-900">{card.pokemonCard.name}</h3>
          <p className="text-sm text-slate-600">{card.pokemonCard.setName}</p>
        </div>
        <span
          className={`rounded-full px-2 py-1 text-xs font-bold uppercase ${
            card.state === "listed" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
          }`}
        >
          {card.state}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-lg bg-slate-100 p-2">
          <p className="text-[11px] uppercase text-slate-500">Acquired</p>
          <p className="font-bold text-slate-900">{formatMoneyCents(card.acquisitionPrice)}</p>
        </div>
        <div className="rounded-lg bg-slate-100 p-2">
          <p className="text-[11px] uppercase text-slate-500">Market</p>
          <p className="font-bold text-slate-900">{formatMoneyCents(card.currentPrice)}</p>
        </div>
        <div className={`rounded-lg p-2 ${card.pnl >= 0 ? "bg-emerald-100" : "bg-rose-100"}`}>
          <p className={`text-[11px] uppercase ${card.pnl >= 0 ? "text-emerald-700" : "text-rose-700"}`}>P&L</p>
          <p className={`font-bold ${card.pnl >= 0 ? "text-emerald-900" : "text-rose-900"}`}>{pnlLabel}</p>
        </div>
      </div>

      {card.state === "owned" ? (
        <div className="mt-4 space-y-2">
          <label htmlFor={`list-price-${card.id}`} className="text-xs font-semibold uppercase tracking-wide text-slate-500">
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
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 outline-none ring-0 transition focus:border-slate-500"
            />
            <button
              type="button"
              disabled={listingPending}
              onClick={() => void onSubmitListing()}
              className={`rounded-xl px-3 py-2 text-sm font-bold transition ${
                listingPending ? "cursor-not-allowed bg-slate-200 text-slate-500" : "bg-slate-900 text-white hover:bg-slate-700"
              }`}
            >
              {listingPending ? "Listing..." : "List"}
            </button>
          </div>
          {localError ? <p className="text-xs font-semibold text-rose-700">{localError}</p> : null}
        </div>
      ) : null}

      {card.state === "listed" && card.activeListing ? (
        <div className="mt-4 flex items-center justify-between rounded-xl bg-amber-50 p-3">
          <div>
            <p className="text-xs uppercase text-amber-700">Active Listing</p>
            <p className="text-sm font-bold text-amber-900">{formatMoneyCents(card.activeListing.price)}</p>
          </div>
          <button
            type="button"
            disabled={cancelPending}
            onClick={() => void onCancelListing(card.activeListing!.id)}
            className={`rounded-xl px-3 py-2 text-sm font-bold transition ${
              cancelPending ? "cursor-not-allowed bg-slate-200 text-slate-500" : "bg-amber-600 text-white hover:bg-amber-700"
            }`}
          >
            {cancelPending ? "Cancelling..." : "Cancel"}
          </button>
        </div>
      ) : null}
    </article>
  );
}
