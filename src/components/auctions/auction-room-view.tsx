"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuction } from "@/hooks/use-auction";
import { useAuth } from "@/hooks/use-auth";
import { useCountdown } from "@/hooks/use-countdown";
import { ApiClientError } from "@/lib/api-client";
import { formatDateTime, formatDollarsInputFromCents, formatMoneyCents, parseDollarsInputToCents } from "@/lib/format";
import { routes } from "@/lib/routes";

type PendingConfirm = {
  amount: number;
  suspiciousCeiling: number;
};

export function AuctionRoomView({ auctionId }: { auctionId: string }): JSX.Element {
  const router = useRouter();
  const { user } = useAuth();
  const { auction, loading, error, clearError, bidPending, watcherCount, refresh, placeBid } = useAuction(auctionId, true);
  const countdown = useCountdown(auction?.endsAt ?? new Date().toISOString());
  const [bidInput, setBidInput] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  // Phase 5 B3 M-1: when the server returns CONFIRMATION_REQUIRED (bid > suspicious
  // ceiling but ≤ hard ceiling), stash the pending bid so the user can give
  // explicit consent via a second click. Hard-ceiling errors never set this.
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  useEffect(() => {
    if (!auction) {
      return;
    }

    setBidInput(formatDollarsInputFromCents(auction.minNextBid));
  }, [auction?.id, auction?.minNextBid]);

  const canBid = Boolean(
    user &&
      auction &&
      auction.status === "active" &&
      auction.sellerId !== user.id &&
      auction.currentBidderId !== user.id
  );

  const submitBid = async (amount: number, confirmHighBid: boolean): Promise<void> => {
    setLocalError(null);
    const outcome = await placeBid(amount, { confirmHighBid });
    if (outcome.ok) {
      setPendingConfirm(null);
      return;
    }
    if (outcome.error instanceof ApiClientError) {
      if (outcome.error.code === "CONFIRMATION_REQUIRED") {
        const ceiling = Number(outcome.error.details?.suspiciousCeiling);
        if (Number.isFinite(ceiling)) {
          setPendingConfirm({ amount, suspiciousCeiling: ceiling });
          // Suppress the default banner while the confirm UI is visible.
          clearError();
          return;
        }
      }
      if (outcome.error.code === "BID_EXCEEDS_HARD_CEILING") {
        // Hard ceiling is terminal per plan §5 / §16.5 — never show confirm UI.
        setPendingConfirm(null);
      }
    }
  };

  const onPlaceBid = async (): Promise<void> => {
    if (!auction) {
      return;
    }

    if (!user) {
      router.push(routes.auth.login);
      return;
    }

    const parsed = parseDollarsInputToCents(bidInput);
    if (parsed === null || parsed <= 0) {
      setLocalError("Bid amount must be a positive dollar value.");
      return;
    }

    const normalized = parsed;
    if (normalized < auction.minNextBid) {
      setLocalError(`Minimum bid is ${formatMoneyCents(auction.minNextBid)}.`);
      return;
    }

    await submitBid(normalized, false);
  };

  const onConfirmHighBid = async (): Promise<void> => {
    if (!pendingConfirm) {
      return;
    }
    await submitBid(pendingConfirm.amount, true);
  };

  const onCancelConfirm = (): void => {
    setPendingConfirm(null);
  };

  const activeError = localError ?? error;
  const isWinner = Boolean(user && auction && auction.status === "completed" && auction.currentBidderId === user.id);
  const winningBid = auction?.currentBid ?? auction?.startingBid ?? 0;
  const winnerDelta = auction ? auction.card.pokemonCard.currentPrice - winningBid : 0;
  const winnerDeltaPositive = winnerDelta >= 0;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-slate-950">Auction Room</h1>
          <p className="mt-1 text-sm text-slate-600">Live bidding with anti-snipe protection and server-authoritative timing.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={routes.auctions.index}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500 hover:bg-slate-50"
          >
            Back to auctions
          </Link>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500 hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading ? <p className="text-sm font-medium text-slate-600">Loading auction...</p> : null}
      {activeError ? <p className="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{activeError}</p> : null}

      {auction ? (
        <>
          {isWinner ? (
            <section className="rounded-2xl border border-emerald-300 bg-gradient-to-br from-emerald-50 via-white to-emerald-100 p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Auction Reward</p>
                  <h2 className="mt-1 text-2xl font-black text-emerald-950">You Won This Auction</h2>
                  <p className="mt-1 text-sm text-emerald-800">
                    The card has been transferred to your collection with acquisition cost set to your winning bid.
                  </p>
                </div>
                <span className="rounded-full bg-emerald-900 px-3 py-1 text-xs font-bold uppercase text-white">
                  Winner
                </span>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl bg-white p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Winning Bid</p>
                  <p className="text-lg font-black text-slate-900">{formatMoneyCents(winningBid)}</p>
                </div>
                <div className="rounded-xl bg-white p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Current Market</p>
                  <p className="text-lg font-black text-slate-900">{formatMoneyCents(auction.card.pokemonCard.currentPrice)}</p>
                </div>
                <div className={`rounded-xl p-3 ${winnerDeltaPositive ? "bg-emerald-100" : "bg-rose-100"}`}>
                  <p className={`text-xs uppercase tracking-wide ${winnerDeltaPositive ? "text-emerald-700" : "text-rose-700"}`}>
                    Position vs Cost
                  </p>
                  <p className={`text-lg font-black ${winnerDeltaPositive ? "text-emerald-900" : "text-rose-900"}`}>
                    {winnerDeltaPositive ? "+" : "-"}
                    {formatMoneyCents(Math.abs(winnerDelta))}
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-emerald-200 bg-white p-3">
                <p className="text-sm font-bold text-slate-900">{auction.card.pokemonCard.name}</p>
                <p className="text-xs text-slate-600">{auction.card.pokemonCard.setName}</p>
              </div>
            </section>
          ) : null}

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{auction.card.pokemonCard.rarityTier}</p>
                <h2 className="mt-1 text-xl font-black text-slate-900">{auction.card.pokemonCard.name}</h2>
                <p className="text-sm text-slate-600">{auction.card.pokemonCard.setName}</p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-slate-500">Status</p>
                <p className="text-sm font-bold text-slate-900">{auction.status}</p>
                <p className="mt-1 text-xs text-slate-500">{watcherCount} watching</p>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-4">
              <div className="rounded-xl bg-slate-100 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Current Bid</p>
                <p className="text-lg font-black text-slate-900">
                  {formatMoneyCents(auction.currentBid ?? auction.startingBid)}
                </p>
              </div>
              <div className="rounded-xl bg-slate-100 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Min Next Bid</p>
                <p className="text-lg font-black text-slate-900">{formatMoneyCents(auction.minNextBid)}</p>
              </div>
              <div className="rounded-xl bg-slate-100 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Leader</p>
                <p className="text-sm font-bold text-slate-900">
                  {auction.currentBidderUsername ? `@${auction.currentBidderUsername}` : "No bids yet"}
                </p>
              </div>
              <div className="rounded-xl bg-slate-100 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Ends</p>
                <p className="text-sm font-bold text-slate-900">{formatDateTime(auction.endsAt)}</p>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-4">
              <div className="rounded-xl bg-slate-950 p-3 text-white">
                <p className="text-xs uppercase tracking-wide text-slate-300">Days</p>
                <p className="text-2xl font-black">{countdown.days}</p>
              </div>
              <div className="rounded-xl bg-slate-950 p-3 text-white">
                <p className="text-xs uppercase tracking-wide text-slate-300">Hours</p>
                <p className="text-2xl font-black">{String(countdown.hours).padStart(2, "0")}</p>
              </div>
              <div className="rounded-xl bg-slate-950 p-3 text-white">
                <p className="text-xs uppercase tracking-wide text-slate-300">Minutes</p>
                <p className="text-2xl font-black">{String(countdown.minutes).padStart(2, "0")}</p>
              </div>
              <div className="rounded-xl bg-slate-950 p-3 text-white">
                <p className="text-xs uppercase tracking-wide text-slate-300">Seconds</p>
                <p className="text-2xl font-black">{String(countdown.seconds).padStart(2, "0")}</p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Anti-snipe: bids in final 30 seconds extend the timer by 30 seconds.
              </p>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Bid (USD)</span>
                <input
                  type="number"
                  min={Math.max(0.5, auction.minNextBid / 100)}
                  step={0.01}
                  value={bidInput}
                  onChange={(event) => {
                    setBidInput(event.target.value);
                    if (localError) {
                      setLocalError(null);
                    }
                    clearError();
                  }}
                  className="w-full border-none bg-transparent text-sm font-semibold text-slate-900 outline-none"
                />
              </label>

              <button
                type="button"
                disabled={!canBid || bidPending}
                onClick={() => void onPlaceBid()}
                className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
                  !canBid || bidPending
                    ? "cursor-not-allowed bg-slate-200 text-slate-500"
                    : "bg-rose-600 text-white hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2"
                }`}
              >
                {bidPending ? "Placing..." : "Place Bid"}
              </button>
            </div>

            {pendingConfirm ? (
              <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
                <p className="text-sm font-bold text-amber-900">
                  Confirm bid above the normal ceiling
                </p>
                <p className="mt-1 text-xs text-amber-800">
                  Your bid of {formatMoneyCents(pendingConfirm.amount)} exceeds the suspicious ceiling of{" "}
                  {formatMoneyCents(pendingConfirm.suspiciousCeiling)}. This is likely an accident. Confirm only
                  if you intended to bid this much.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={bidPending}
                    onClick={() => void onConfirmHighBid()}
                    className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
                      bidPending
                        ? "cursor-not-allowed bg-slate-200 text-slate-500"
                        : "bg-amber-600 text-white hover:bg-amber-700"
                    }`}
                  >
                    {bidPending ? "Placing..." : "Confirm and place bid"}
                  </button>
                  <button
                    type="button"
                    disabled={bidPending}
                    onClick={onCancelConfirm}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}

            {!user ? (
              <p className="mt-3 text-sm font-medium text-amber-700">
                Login to bid. Viewing and live updates are public.
              </p>
            ) : null}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-black text-slate-900">Live Bid Feed</h3>
            {auction.bids.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">No bids yet. Opening bid starts at {formatMoneyCents(auction.startingBid)}.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {auction.bids.map((bid) => (
                  <article key={bid.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                    <div>
                      <p className="text-sm font-bold text-slate-900">@{bid.bidderUsername}</p>
                      <p className="text-xs text-slate-500">{formatDateTime(bid.createdAt)}</p>
                    </div>
                    <p className="text-sm font-black text-slate-900">{formatMoneyCents(bid.amount)}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}
