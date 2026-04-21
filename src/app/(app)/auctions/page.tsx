"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AuctionListingCard } from "@/components/auctions/auction-listing-card";
import { Button } from "@/components/ui/button";
import { CardGrid } from "@/components/ui/card-grid";
import { PaginationFooter } from "@/components/ui/pagination-footer";
import { useAuctions } from "@/hooks/use-auctions";
import { useAuth } from "@/hooks/use-auth";
import { formatDollarsInputFromCents, formatMoneyCents, parseDollarsInputToCents } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { AuctionDurationType } from "@/lib/types";

const DURATION_OPTIONS: Array<{ value: AuctionDurationType; label: string }> = [
  { value: "1h", label: "1 hour" },
  { value: "6h", label: "6 hours" },
  { value: "24h", label: "24 hours" }
];
const MIN_STARTING_BID_CENTS = 50;

export default function AuctionsPage(): JSX.Element {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const auctions = useAuctions(Boolean(user));
  const [startingBidByCard, setStartingBidByCard] = useState<Record<string, string>>({});
  const [durationByCard, setDurationByCard] = useState<Record<string, AuctionDurationType>>({});
  const [localError, setLocalError] = useState<string | null>(null);

  const getDefaultStartingBidCents = (card: { currentPrice: number }): number =>
    Math.max(Math.trunc(card.currentPrice), MIN_STARTING_BID_CENTS);

  const itemLabel = useMemo(() => {
    if (auctions.auctions.length === 1) {
      return "1 active auction loaded";
    }
    return `${auctions.auctions.length} loaded${auctions.total ? ` of ${auctions.total}` : ""}`;
  }, [auctions.auctions.length, auctions.total]);

  const onCreateAuction = async (cardId: string): Promise<void> => {
    const card = auctions.ownedCards.find((item) => item.id === cardId);
    if (!card) {
      setLocalError("Card is no longer available to auction.");
      return;
    }

    const startingBidRaw = startingBidByCard[cardId] ?? formatDollarsInputFromCents(getDefaultStartingBidCents(card));
    const parsedStartingBid = parseDollarsInputToCents(startingBidRaw);
    const durationType = durationByCard[cardId] ?? "1h";

    if (parsedStartingBid === null || parsedStartingBid < MIN_STARTING_BID_CENTS) {
      setLocalError("Starting bid must be at least $0.50.");
      return;
    }

    setLocalError(null);
    const auctionId = await auctions.createAuction({
      cardId,
      startingBid: parsedStartingBid,
      durationType
    });

    if (auctionId) {
      router.push(routes.auctions.detail(auctionId));
    }
  };

  if (authLoading) {
    return <p className="text-sm font-medium text-slate-600">Checking session...</p>;
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-slate-950">Auctions</h1>
          <p className="mt-1 text-sm text-slate-600">
            Real-time bidding rooms with anti-snipe extension and hold-protected available balance.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void auctions.refresh()}>
          Refresh
        </Button>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-slate-700">{itemLabel}</p>
      </section>

      {auctions.loading ? <p className="text-sm font-medium text-slate-600">Loading auctions...</p> : null}
      {auctions.error ? <p className="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{auctions.error}</p> : null}
      {localError ? <p className="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{localError}</p> : null}

      {!authLoading && !user ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Login to create auctions from your owned cards. Browsing and watching auction rooms is public.{" "}
          <Link href={routes.auth.login} className="font-bold underline">
            Sign in
          </Link>
          .
        </section>
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-black text-slate-900">Create Auction From Owned Cards</h2>
          {auctions.ownedCards.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">
              No owned cards available. Open packs first, then return to create an auction.
            </p>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {auctions.ownedCards.map((card) => {
                const currentInput =
                  startingBidByCard[card.id] ?? formatDollarsInputFromCents(getDefaultStartingBidCents(card));
                const currentDuration = durationByCard[card.id] ?? "1h";
                const pending = auctions.createPendingCardId === card.id;

                return (
                  <article key={card.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{card.pokemonCard.rarityTier}</p>
                    <p className="mt-1 text-sm font-black text-slate-900">{card.pokemonCard.name}</p>
                    <p className="text-xs text-slate-600">{card.pokemonCard.setName}</p>

                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg bg-white p-2">
                        <p className="uppercase text-slate-500">Market</p>
                        <p className="font-bold text-slate-900">{formatMoneyCents(card.currentPrice)}</p>
                      </div>
                      <div className="rounded-lg bg-white p-2">
                        <p className="uppercase text-slate-500">Acquired</p>
                        <p className="font-bold text-slate-900">{formatMoneyCents(card.acquisitionPrice)}</p>
                      </div>
                    </div>

                    <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Starting Bid (USD)
                      <input
                        type="number"
                        min={0.5}
                        step={0.01}
                        value={currentInput}
                        onChange={(event) =>
                          setStartingBidByCard((previous) => ({
                            ...previous,
                            [card.id]: event.target.value
                          }))
                        }
                        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none transition focus:border-slate-500"
                      />
                      <p className="mt-1 text-[11px] font-medium normal-case tracking-normal text-slate-500">
                        Defaults to current market value (minimum $0.50).
                      </p>
                    </label>

                    <label className="mt-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Duration
                      <select
                        value={currentDuration}
                        onChange={(event) =>
                          setDurationByCard((previous) => ({
                            ...previous,
                            [card.id]: event.target.value as AuctionDurationType
                          }))
                        }
                        className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none transition focus:border-slate-500"
                      >
                        {DURATION_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <Button
                      fullWidth
                      loading={pending}
                      onClick={() => void onCreateAuction(card.id)}
                      className="mt-3"
                    >
                      {pending ? "Creating..." : "Create Auction"}
                    </Button>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {!auctions.loading && !auctions.error && auctions.auctions.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          No active auctions right now.
        </div>
      ) : null}

      <CardGrid
        items={auctions.auctions}
        ariaLabel="Auctions"
        itemKey={(auction) => auction.id}
        renderItem={(auction) => <AuctionListingCard auction={auction} currentUserId={user?.id ?? null} />}
      />

      <PaginationFooter
        hasMore={auctions.hasMore}
        loading={auctions.loadingMore}
        onLoadMore={() => {
          void auctions.loadMore();
        }}
        loadedCount={auctions.auctions.length}
        totalCount={auctions.total}
      />
    </section>
  );
}
