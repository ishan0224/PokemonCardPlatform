"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuction } from "@/hooks/use-auction";
import { useAuth } from "@/hooks/use-auth";
import { Button, buttonClassName } from "@/components/ui/button";
import { CardImage } from "@/components/ui/card-image";
import { Chip } from "@/components/ui/chip";
import { CountdownPill } from "@/components/ui/countdown-pill";
import { RarityBadge } from "@/components/ui/rarity-badge";
import { ApiClientError } from "@/lib/api-client";
import { formatDollarsInputFromCents, formatMoneyCents, parseDollarsInputToCents } from "@/lib/format";
import { routes } from "@/lib/routes";

type PendingConfirm = {
  amount: number;
  suspiciousCeiling: number | null;
  finalWindow: {
    windowStartedAt: string;
    effectiveEndsAt: string;
  } | null;
  confirmHighBid: boolean;
  confirmFinalWindowBid: boolean;
};

const ADVISORY_FINAL_WINDOW_PCT = 10;
const ADVISORY_FINAL_WINDOW_MIN_SECONDS = 60;

function formatRelative(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const deltaSec = Math.max(0, (Date.now() - parsed.getTime()) / 1000);
  if (deltaSec < 60) return `${Math.max(1, Math.floor(deltaSec))}s ago`;
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
  const days = Math.floor(deltaSec / 86400);
  return days === 1 ? "1d ago" : `${days}d ago`;
}

function statusChip(status: string, endsAt: string): JSX.Element {
  if (status === "active") {
    const remainingMs = new Date(endsAt).getTime() - Date.now();
    if (remainingMs > 0 && remainingMs < 5 * 60 * 1000) {
      return (
        <Chip tone="live" pulse>
          Live · ending soon
        </Chip>
      );
    }
    return (
      <Chip tone="live" pulse>
        Live
      </Chip>
    );
  }
  if (status === "completed") return <Chip tone="completed">Completed</Chip>;
  if (status === "cancelled") return <Chip tone="neutral">Cancelled</Chip>;
  return <Chip tone="neutral">{status}</Chip>;
}

function computeAdvisoryFinalWindow(input: {
  createdAt: string;
  originalEndTime: string;
  endsAt: string;
}): { inFinalWindow: boolean; windowStartedAt: string } {
  const createdAtMs = Date.parse(input.createdAt);
  const originalEndTimeMs = Date.parse(input.originalEndTime);
  const effectiveEndsAtMs = Date.parse(input.endsAt);
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(originalEndTimeMs) || !Number.isFinite(effectiveEndsAtMs)) {
    return {
      inFinalWindow: false,
      windowStartedAt: input.endsAt
    };
  }

  const durationMs = Math.max(0, originalEndTimeMs - createdAtMs);
  const windowSpanMs = Math.max(
    ADVISORY_FINAL_WINDOW_MIN_SECONDS * 1_000,
    Math.trunc((durationMs * ADVISORY_FINAL_WINDOW_PCT) / 100)
  );
  const windowStartedAtMs = effectiveEndsAtMs - windowSpanMs;
  return {
    inFinalWindow: Date.now() >= windowStartedAtMs && Date.now() < effectiveEndsAtMs,
    windowStartedAt: new Date(windowStartedAtMs).toISOString()
  };
}

export function AuctionRoomView({ auctionId }: { auctionId: string }): JSX.Element {
  const router = useRouter();
  const { user } = useAuth();
  const {
    auction,
    loading,
    error,
    clearError,
    bidPending,
    watcherCount,
    refresh,
    placeBid
  } = useAuction(auctionId, true);
  const [bidInput, setBidInput] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  useEffect(() => {
    if (!auction) return;
    setBidInput(formatDollarsInputFromCents(auction.minNextBid));
  }, [auction?.id, auction?.minNextBid]);

  const canBid = Boolean(
    user &&
      auction &&
      auction.status === "active" &&
      auction.sellerId !== user.id &&
      auction.currentBidderId !== user.id
  );
  const isSeller = Boolean(user && auction && auction.sellerId === user.id);
  const isLeader = Boolean(user && auction && auction.currentBidderId === user.id);

  const currentBid = auction ? (auction.currentBid ?? auction.startingBid) : 0;
  const advisoryFinalWindow = useMemo(() => {
    if (!auction) {
      return { inFinalWindow: false, windowStartedAt: null as string | null };
    }
    const resolved = computeAdvisoryFinalWindow({
      createdAt: auction.createdAt,
      originalEndTime: auction.originalEndTime,
      endsAt: auction.endsAt
    });
    return {
      inFinalWindow: resolved.inFinalWindow,
      windowStartedAt: resolved.windowStartedAt
    };
  }, [auction]);

  const submitBid = async (
    amount: number,
    flags?: { confirmHighBid?: boolean; confirmFinalWindowBid?: boolean }
  ): Promise<void> => {
    setLocalError(null);
    const outcome = await placeBid(amount, {
      confirmHighBid: flags?.confirmHighBid,
      confirmFinalWindowBid: flags?.confirmFinalWindowBid
    });
    if (outcome.ok) {
      setPendingConfirm(null);
      return;
    }
    if (outcome.error instanceof ApiClientError) {
      if (outcome.error.code === "FINAL_WINDOW_CONFIRMATION_REQUIRED") {
        const windowStartedAt = outcome.error.details?.windowStartedAt;
        const effectiveEndsAt = outcome.error.details?.effectiveEndsAt;
        if (typeof windowStartedAt === "string" && typeof effectiveEndsAt === "string") {
          setPendingConfirm((previous) => ({
            amount,
            suspiciousCeiling:
              previous && previous.amount === amount ? previous.suspiciousCeiling : null,
            finalWindow: {
              windowStartedAt,
              effectiveEndsAt
            },
            confirmHighBid: previous?.amount === amount ? previous.confirmHighBid : false,
            confirmFinalWindowBid: false
          }));
          clearError();
          return;
        }
      }

      if (outcome.error.code === "CONFIRMATION_REQUIRED") {
        const ceiling = Number(outcome.error.details?.suspiciousCeiling);
        if (Number.isFinite(ceiling)) {
          setPendingConfirm((previous) => ({
            amount,
            suspiciousCeiling: ceiling,
            finalWindow: previous?.amount === amount ? previous.finalWindow : null,
            confirmHighBid: false,
            confirmFinalWindowBid:
              previous?.amount === amount ? previous.confirmFinalWindowBid : false
          }));
          clearError();
          return;
        }
      }
      if (outcome.error.code === "BID_EXCEEDS_HARD_CEILING") {
        setPendingConfirm(null);
      }
    }
  };

  const onPlaceBid = async (): Promise<void> => {
    if (!auction) return;
    if (!user) {
      router.push(routes.auth.login);
      return;
    }
    const parsed = parseDollarsInputToCents(bidInput);
    if (parsed === null || parsed <= 0) {
      setLocalError("Bid amount must be a positive dollar value.");
      return;
    }
    if (parsed < auction.minNextBid) {
      setLocalError(`Minimum bid is ${formatMoneyCents(auction.minNextBid)}.`);
      return;
    }
    setPendingConfirm(null);
    await submitBid(parsed);
  };

  const onBump = (cents: number): void => {
    const current = parseDollarsInputToCents(bidInput) ?? auction?.minNextBid ?? 0;
    setBidInput(formatDollarsInputFromCents(current + cents));
    if (localError) setLocalError(null);
    clearError();
  };

  const onConfirmBid = async (): Promise<void> => {
    if (!pendingConfirm) return;
    await submitBid(pendingConfirm.amount, {
      confirmHighBid: pendingConfirm.suspiciousCeiling !== null ? pendingConfirm.confirmHighBid : undefined,
      confirmFinalWindowBid:
        pendingConfirm.finalWindow !== null ? pendingConfirm.confirmFinalWindowBid : undefined
    });
  };

  const extensions = useMemo((): number => {
    if (!auction?.originalEndTime || !auction.endsAt) return 0;
    const diff = new Date(auction.endsAt).getTime() - new Date(auction.originalEndTime).getTime();
    if (diff <= 0) return 0;
    return Math.round(diff / 30_000);
  }, [auction?.endsAt, auction?.originalEndTime]);

  const isWinner = Boolean(user && auction && auction.status === "completed" && auction.currentBidderId === user.id);
  const winningBid = auction?.currentBid ?? auction?.startingBid ?? 0;
  const highBidConfirmRequired = pendingConfirm?.suspiciousCeiling !== null;
  const finalWindowConfirmRequired = pendingConfirm?.finalWindow !== null;
  const canSubmitPendingConfirm = Boolean(
    pendingConfirm &&
      (!highBidConfirmRequired || pendingConfirm.confirmHighBid) &&
      (!finalWindowConfirmRequired || pendingConfirm.confirmFinalWindowBid)
  );

  const activeError = localError ?? error;

  return (
    <section className="space-y-4">
      {/* BREADCRUMB */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-[12px]">
          <Link href={routes.auctions.index} className="text-pv-muted hover:text-pv-text">
            ← Auctions
          </Link>
          {auction ? (
            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
              {auction.card.pokemonCard.name} · #{auction.id.slice(0, 6)}
            </span>
          ) : null}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => void refresh()}>
          Refresh
        </Button>
      </div>

      {loading ? <p className="text-sm font-medium text-pv-muted">Loading auction…</p> : null}
      {activeError ? (
        <p
          role="alert"
          className="rounded-pv-sm border border-pv-accent/30 bg-[rgba(239,68,68,0.08)] p-3 text-sm font-medium text-[#fca5a5]"
        >
          {activeError}
        </p>
      ) : null}

      {auction ? (
        <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          {/* LEFT — card + bid panel */}
          <div className="space-y-3">
            <article className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {statusChip(auction.status, auction.endsAt)}
                  <span className="text-[12px] text-pv-muted">
                    {watcherCount} watchers · {auction.bids.length} bids
                  </span>
                </div>
                <RarityBadge rarity={auction.card.pokemonCard.rarityTier} />
              </div>

              <div className="mt-4 grid gap-5 sm:grid-cols-[220px_1fr]">
                <div className="flex justify-center sm:justify-start">
                  <CardImage
                    src={auction.card.pokemonCard.imageUrl}
                    hiresSrc={auction.card.pokemonCard.imageUrlHires}
                    alt={auction.card.pokemonCard.name}
                    size="md"
                    rarityTier={auction.card.rarityTier}
                  />
                </div>
                <div>
                  <h1 className="text-pv-h1">{auction.card.pokemonCard.name}</h1>
                  <p className="mt-1 text-[13px] text-pv-muted">
                    {auction.card.pokemonCard.setName} · seller @{auction.sellerUsername}
                  </p>

                  <div className="mt-4 flex flex-wrap items-start gap-5">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
                        {auction.currentBid === null ? "Starting bid" : "Current bid"}
                      </p>
                      <p className="mt-1 text-pv-display text-pv-gold tabular-nums">
                        {formatMoneyCents(currentBid)}
                      </p>
                      {auction.currentBidderUsername ? (
                        <p className="text-[12px] text-pv-muted">
                          Leader @{auction.currentBidderUsername}
                        </p>
                      ) : null}
                    </div>
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
                        Ends in
                      </p>
                      <div className="mt-1">
                        <CountdownPill targetIso={auction.endsAt} />
                      </div>
                    </div>
                  </div>

                  {/* BID COMPOSER */}
                  <div className="mt-4 rounded-pv border border-pv-line bg-pv-surface-3 p-[14px_16px]">
                    <label
                      htmlFor="auction-bid-input"
                      className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted-2"
                    >
                      Your bid
                    </label>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        id="auction-bid-input"
                        type="number"
                        min={Math.max(0.5, auction.minNextBid / 100)}
                        step={0.01}
                        value={bidInput}
                        onChange={(event) => {
                          setBidInput(event.target.value);
                          if (localError) setLocalError(null);
                          clearError();
                        }}
                        className="min-h-11 w-32 flex-1 rounded-pv-sm border border-pv-line bg-pv-surface-2 px-3 py-2 text-[14px] font-semibold text-pv-text outline-none transition focus:border-pv-gold focus:ring-2 focus:ring-pv-gold/25"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => onBump(100)}
                        disabled={!canBid || bidPending}
                      >
                        +$1
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => onBump(500)}
                        disabled={!canBid || bidPending}
                      >
                        +$5
                      </Button>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        loading={bidPending}
                        disabled={!canBid || bidPending}
                        onClick={() => void onPlaceBid()}
                      >
                        {bidPending ? "Placing…" : "Place bid"}
                      </Button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px]">
                      <span className="text-pv-muted">
                        Min increment {formatMoneyCents(auction.minNextBid - currentBid)} · Balance on hold
                        during auction
                      </span>
                      {advisoryFinalWindow.inFinalWindow ? (
                        <span className="font-bold text-pv-warn">Final-window bidding is active</span>
                      ) : null}
                      {isLeader ? (
                        <span className="font-bold text-pv-good">You currently lead</span>
                      ) : isSeller ? (
                        <span className="font-bold text-pv-muted">Your auction</span>
                      ) : !user ? (
                        <Link
                          href={routes.auth.login}
                          className="font-bold text-pv-gold hover:underline"
                        >
                          Log in to bid
                        </Link>
                      ) : null}
                    </div>

                    {pendingConfirm ? (
                      <div className="mt-3 rounded-pv-sm border border-pv-warn/28 bg-[rgba(245,158,11,0.08)] p-3">
                        <p className="text-[13px] font-bold text-pv-warn">Bid confirmation required</p>
                        {highBidConfirmRequired ? (
                          <p className="mt-1 text-[12px] text-pv-warn/90">
                            Your bid of {formatMoneyCents(pendingConfirm.amount)} exceeds the suspicious
                            ceiling of {formatMoneyCents(pendingConfirm.suspiciousCeiling ?? 0)}.
                          </p>
                        ) : null}
                        {finalWindowConfirmRequired ? (
                          <p className="mt-1 text-[12px] text-pv-warn/90">
                            This bid is in the final window (started{" "}
                            {formatRelative(pendingConfirm.finalWindow?.windowStartedAt ?? auction.endsAt)}).
                          </p>
                        ) : null}
                        <div className="mt-3 space-y-2">
                          {highBidConfirmRequired ? (
                            <label className="flex items-start gap-2 text-[12px] text-pv-warn/95">
                              <input
                                type="checkbox"
                                checked={pendingConfirm.confirmHighBid}
                                onChange={(event) => {
                                  const checked = event.target.checked;
                                  setPendingConfirm((previous) =>
                                    previous ? { ...previous, confirmHighBid: checked } : previous
                                  );
                                }}
                                className="mt-0.5 h-4 w-4 rounded border-pv-warn/60 bg-transparent text-pv-warn"
                              />
                              <span>I confirm this high-value bid amount.</span>
                            </label>
                          ) : null}
                          {finalWindowConfirmRequired ? (
                            <label className="flex items-start gap-2 text-[12px] text-pv-warn/95">
                              <input
                                type="checkbox"
                                checked={pendingConfirm.confirmFinalWindowBid}
                                onChange={(event) => {
                                  const checked = event.target.checked;
                                  setPendingConfirm((previous) =>
                                    previous ? { ...previous, confirmFinalWindowBid: checked } : previous
                                  );
                                }}
                                className="mt-0.5 h-4 w-4 rounded border-pv-warn/60 bg-transparent text-pv-warn"
                              />
                              <span>I understand this is a final-window bid.</span>
                            </label>
                          ) : null}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="gold"
                            size="sm"
                            loading={bidPending}
                            disabled={!canSubmitPendingConfirm || bidPending}
                            onClick={() => void onConfirmBid()}
                          >
                            {bidPending ? "Placing…" : "Confirm and place bid"}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setPendingConfirm(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </article>

            {/* SOFT-CLOSE NOTICE */}
            <div className="rounded-pv-lg border border-pv-info/28 bg-[rgba(56,189,248,0.04)] px-[14px] py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-extrabold text-pv-info">Anti-snipe</span>
                  <span className="text-[12px] text-pv-muted">
                    Bids in the last 30s extend the timer by 30s. Final-window confirmations apply in
                    the endgame.
                  </span>
                </div>
                <span className="text-[12px] text-pv-muted">
                  Extensions so far: {extensions}
                  {advisoryFinalWindow.inFinalWindow && advisoryFinalWindow.windowStartedAt
                    ? ` · final window since ${formatRelative(advisoryFinalWindow.windowStartedAt)}`
                    : ""}
                </span>
              </div>
            </div>

            {/* WINNER BANNER */}
            {isWinner ? (
              <div className="rounded-pv-lg border border-pv-good/30 bg-[rgba(16,185,129,0.06)] p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-good">
                      Auction reward
                    </p>
                    <h2 className="mt-1 text-pv-h2 text-pv-good">You won this auction</h2>
                    <p className="mt-1 text-[13px] text-pv-muted">
                      The card has been transferred to your collection with acquisition cost set to your
                      winning bid of {formatMoneyCents(winningBid)}.
                    </p>
                  </div>
                  <Link
                    href={routes.collection.index}
                    className={buttonClassName({ variant: "primary", size: "sm" })}
                  >
                    View in collection
                  </Link>
                </div>
              </div>
            ) : null}
          </div>

          {/* RIGHT — bid feed + about */}
          <div className="space-y-3">
            <div className="overflow-hidden rounded-pv-lg border border-pv-line bg-pv-surface-2">
              <div className="flex items-center justify-between border-b border-pv-line px-4 py-3">
                <div className="text-pv-h3">Bid history</div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-pv-surface-3 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.04em] text-pv-muted">
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 rounded-full bg-pv-good motion-safe:animate-pv-pulse"
                  />
                  Streaming
                </span>
              </div>
              <ul className="px-[14px] py-2">
                {auction.bids.length === 0 ? (
                  <li className="px-1 py-3 text-[12px] text-pv-muted">
                    No bids yet. Opening bid {formatMoneyCents(auction.startingBid)}.
                  </li>
                ) : (
                  auction.bids.map((bid, index) => (
                    <li
                      key={bid.id}
                      className={`flex items-center justify-between px-1 py-2 ${
                        index < auction.bids.length - 1 ? "border-b border-pv-line" : ""
                      }`}
                    >
                      <div>
                        <div className="text-[13px] font-bold text-pv-text">@{bid.bidderUsername}</div>
                        <div className="text-[11px] text-pv-muted">{formatRelative(bid.createdAt)}</div>
                      </div>
                      <div
                        className={`text-[13px] font-extrabold tabular-nums ${
                          index === 0 ? "text-pv-gold" : "text-pv-text"
                        }`}
                      >
                        {formatMoneyCents(bid.amount)}
                      </div>
                    </li>
                  ))
                )}
                <li className="flex items-center justify-between px-1 py-2 text-[12px] text-pv-muted">
                  <div>
                    <div className="font-bold text-pv-muted">@{auction.sellerUsername}</div>
                    <div className="text-[11px] text-pv-muted-2">opened</div>
                  </div>
                  <div className="font-bold">
                    Starting bid · {formatMoneyCents(auction.startingBid)}
                  </div>
                </li>
              </ul>
            </div>

            {/* ABOUT CARD */}
            <div className="space-y-2 rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5">
              <div className="text-pv-h3 mb-1">About this card</div>
              <div className="flex items-center justify-between text-[12px] text-pv-muted">
                <span>Set</span>
                <span className="font-semibold text-pv-text">{auction.card.pokemonCard.setName}</span>
              </div>
              <div className="flex items-center justify-between text-[12px] text-pv-muted">
                <span>Rarity</span>
                <RarityBadge rarity={auction.card.pokemonCard.rarityTier} />
              </div>
              <div className="flex items-center justify-between text-[12px] text-pv-muted">
                <span>Seller</span>
                <span className="font-semibold text-pv-text">@{auction.sellerUsername}</span>
              </div>
              <div className="flex items-center justify-between text-[12px] text-pv-muted">
                <span>Provably fair</span>
                <Link
                  href={routes.collection.index}
                  className="font-bold text-pv-good hover:underline"
                >
                  ✓ Verify via owner
                </Link>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
