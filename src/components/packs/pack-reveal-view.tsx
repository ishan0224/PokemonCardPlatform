"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePackReveal } from "@/hooks/use-pack-reveal";
import { useAuth } from "@/hooks/use-auth";
import { Button, buttonClassName } from "@/components/ui/button";
import { CardImage } from "@/components/ui/card-image";
import { CardShell } from "@/components/ui/card-shell";
import { Chip } from "@/components/ui/chip";
import { RarityBadge } from "@/components/ui/rarity-badge";
import { StatTile } from "@/components/ui/stat-tile";
import { formatMoneyCents, formatTierLabel } from "@/lib/format";
import { ApiClientError, type PackCard } from "@/lib/api-client";
import type { RarityTier } from "@/lib/types";
import { routes } from "@/lib/routes";

const RevealSlotCardAnimated = dynamic(
  () => import("./reveal-slot-card-animated").then((module) => module.RevealSlotCardAnimated),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-[360px] rounded-pv-lg border border-pv-line bg-pv-surface-2" />
    )
  }
);

const RARITY_RANK: Record<RarityTier, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  holo_rare: 3,
  ultra_rare: 4,
  chase: 5
};

function formatRelative(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const deltaSec = Math.max(0, (Date.now() - parsed.getTime()) / 1000);
  if (deltaSec < 60) return "just now";
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
  const days = Math.floor(deltaSec / 86400);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

function peakRarity(cards: PackCard[]): RarityTier | null {
  if (cards.length === 0) return null;
  return cards.reduce<RarityTier>((best, card) => {
    return RARITY_RANK[card.rarityTier] > RARITY_RANK[best] ? card.rarityTier : best;
  }, cards[0].rarityTier);
}

export function PackRevealView({ packId }: { packId: string }): JSX.Element {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [packBurstActive, setPackBurstActive] = useState(false);
  const [showSummaryOverlay, setShowSummaryOverlay] = useState(false);
  const prevAllRevealedRef = useRef(false);
  const burstTimerRef = useRef<number | null>(null);
  const {
    pack,
    loading,
    error,
    openPending,
    revealPendingSlot,
    slotOrder,
    revealedCardsBySlot,
    openPack,
    revealNext,
    revealSlot
  } = usePackReveal(packId);

  const revealedCards = useMemo<PackCard[]>(
    () => slotOrder.map((slot) => revealedCardsBySlot[slot]).filter((card): card is PackCard => Boolean(card)),
    [slotOrder, revealedCardsBySlot]
  );
  const unrevealedCount = slotOrder.filter((slot) => !revealedCardsBySlot[slot]).length;
  const canReveal = slotOrder.length > 0 && unrevealedCount > 0;
  const allRevealed = Boolean(pack?.opened) && slotOrder.length > 0 && unrevealedCount === 0;
  const totalPackMarketValue = useMemo(
    () => revealedCards.reduce((sum, card) => sum + card.pokemonCard.currentPrice, 0),
    [revealedCards]
  );
  const pricePaid = pack?.pricePaid ?? 0;
  const pnlAmount = totalPackMarketValue - pricePaid;
  const pnlPositive = pnlAmount >= 0;
  const pnlPct = pricePaid > 0 ? (pnlAmount / pricePaid) * 100 : 0;
  const peak = peakRarity(revealedCards);

  useEffect(() => {
    if (allRevealed && !prevAllRevealedRef.current) {
      setShowSummaryOverlay(true);
    }
    prevAllRevealedRef.current = allRevealed;
  }, [allRevealed]);

  useEffect(() => {
    setPackBurstActive(false);
    setShowSummaryOverlay(false);
  }, [packId]);

  useEffect(() => {
    return () => {
      if (burstTimerRef.current !== null) {
        window.clearTimeout(burstTimerRef.current);
      }
    };
  }, []);

  const triggerPackBurst = (): void => {
    setPackBurstActive(true);
    if (burstTimerRef.current !== null) {
      window.clearTimeout(burstTimerRef.current);
    }
    burstTimerRef.current = window.setTimeout(() => {
      setPackBurstActive(false);
      burstTimerRef.current = null;
    }, 500);
  };

  const onOpen = async (): Promise<void> => {
    try {
      await openPack();
      triggerPackBurst();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        router.push(routes.auth.login);
      }
    }
  };

  const onAutoReveal = async (): Promise<void> => {
    const pending = slotOrder.filter((slot) => !revealedCardsBySlot[slot]);
    for (const slot of pending) {
      try {
        await revealSlot(slot);
      } catch {
        break;
      }
    }
  };

  if (!authLoading && !user && !loading) {
    return (
      <section className="rounded-pv-lg border border-pv-warn/28 bg-[rgba(245,158,11,0.06)] p-5 text-sm font-medium text-pv-warn">
        Login is required to access pack reveals.{" "}
        <Link href={routes.auth.login} className="font-bold underline">
          Sign in
        </Link>
        .
      </section>
    );
  }

  const crumbParts = pack
    ? [formatTierLabel(pack.tier), `Pack #${pack.id.slice(0, 8)}`, formatRelative(pack.purchasedAt)]
    : [];

  return (
    <section className="space-y-5">
      {/* BACK BREADCRUMB */}
      <div className="flex items-center gap-3 text-[12px]">
        <Link href={routes.packs.index} className="text-pv-muted hover:text-pv-text">
          ← My packs
        </Link>
        {pack ? (
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
            Reveal · #{pack.id.slice(0, 8)}
          </span>
        ) : null}
      </div>

      {loading ? <p className="text-sm font-medium text-pv-muted">Loading pack…</p> : null}
      {error ? (
        <p
          role="alert"
          className="rounded-pv-sm border border-pv-accent/30 bg-[rgba(239,68,68,0.08)] p-3 text-sm font-medium text-[#fca5a5]"
        >
          {error}
        </p>
      ) : null}

      {pack ? (
        <>
          {/* SUMMARY CARD */}
          <section className="relative overflow-hidden rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5">
            {packBurstActive ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-10 animate-pv-pulse bg-gradient-to-r from-transparent via-pv-gold/10 to-transparent"
              />
            ) : null}
            <div className="relative z-20">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
                    {crumbParts.join(" · ")}
                  </p>
                  <h1 id="pack-reveal-heading" className="mt-1 text-pv-h1">
                    Your pack
                  </h1>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={routes.fairness.verify(pack.id)}
                    className={buttonClassName({ variant: "ghost", size: "sm" })}
                  >
                    Verify this pack
                  </Link>
                  {pack.opened ? (
                    <Chip tone={allRevealed ? "info" : "upcoming"}>
                      {allRevealed
                        ? `Opened · ${slotOrder.length} / ${slotOrder.length} revealed`
                        : `Opened · ${slotOrder.length - unrevealedCount} / ${slotOrder.length} revealed`}
                    </Chip>
                  ) : (
                    <Chip tone="gold">Sealed</Chip>
                  )}
                </div>
              </div>

              {pack.opened ? (
                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <StatTile
                    label="Paid"
                    value={formatMoneyCents(pricePaid)}
                    valueClassName="text-[20px]"
                  />
                  <StatTile
                    label="Total value"
                    value={formatMoneyCents(totalPackMarketValue)}
                    valueClassName="text-[20px]"
                  />
                  <StatTile
                    label="P&L"
                    tone={pnlPositive ? "good" : "bad"}
                    value={
                      <span className={pnlPositive ? "text-pv-good" : "text-pv-accent"}>
                        {pnlAmount > 0 ? "+" : pnlAmount < 0 ? "-" : ""}
                        {formatMoneyCents(Math.abs(pnlAmount))}
                      </span>
                    }
                    valueClassName="text-[20px]"
                    delta={pricePaid > 0 ? `${pnlAmount >= 0 ? "+" : ""}${pnlPct.toFixed(0)}%` : undefined}
                  />
                  <StatTile
                    label="Rarity peak"
                    value={peak ? <RarityBadge rarity={peak} /> : <span className="text-pv-muted">—</span>}
                    valueClassName="text-[14px]"
                  />
                </div>
              ) : (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="gold"
                    loading={openPending}
                    onClick={() => void onOpen()}
                  >
                    {openPending ? "Opening…" : "Open pack"}
                  </Button>
                  <p className="text-[12px] text-pv-muted">
                    Opening commits the pack and reveals the first slot options.
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* SLOTS */}
          {pack.opened ? (
            <section>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-pv-h2">Slots</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!canReveal || revealPendingSlot !== null}
                    onClick={() => void onAutoReveal()}
                  >
                    Auto-reveal remaining
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={!canReveal || revealPendingSlot !== null}
                    loading={revealPendingSlot !== null}
                    onClick={() => void revealNext()}
                  >
                    {canReveal ? "Reveal next slot" : "All revealed"}
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {slotOrder.map((slot) => (
                  <RevealSlotCardAnimated
                    key={slot}
                    slotNumber={slot}
                    card={revealedCardsBySlot[slot]}
                    pending={revealPendingSlot === slot}
                    onReveal={async () => {
                      await revealSlot(slot);
                    }}
                  />
                ))}
              </div>
            </section>
          ) : (
            <div className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5 text-sm text-pv-muted">
              Open the pack to initialise reveal slots.
            </div>
          )}

          {/* WHAT NEXT */}
          {pack.opened ? (
            <CardShell
              variant="surface"
              tone="default"
              header={
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-pv-h3">What next?</div>
                    <p className="mt-0.5 text-[12px] text-pv-muted">
                      Keep them, list on marketplace, or auction the chase.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={routes.collection.index}
                      className={buttonClassName({ variant: "secondary", size: "sm" })}
                    >
                      View in collection
                    </Link>
                    <Link
                      href={routes.marketplace.index}
                      className={buttonClassName({ variant: "primary", size: "sm" })}
                    >
                      List on marketplace
                    </Link>
                  </div>
                </div>
              }
            />
          ) : null}

          {/* PACK SUMMARY OVERLAY */}
          {showSummaryOverlay && allRevealed ? (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
              onClick={() => setShowSummaryOverlay(false)}
              role="dialog"
              aria-label="Pack summary"
            >
              <div
                className="mx-4 max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-pv-xl border border-pv-line bg-pv-surface-2 p-6 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="text-center">
                  <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-pv-gold">Pack opened</p>
                  <h2 className="mt-1 text-pv-h1">Your cards</h2>
                  <p className="mt-1 text-[13px] text-pv-muted">
                    Total market value: <span className="font-extrabold text-pv-text">{formatMoneyCents(totalPackMarketValue)}</span>
                  </p>
                </div>
                <div className="mt-5 space-y-2.5">
                  {revealedCards.map((rc) => (
                    <div key={rc.slotNumber} className="flex items-center gap-3 rounded-pv-sm border border-pv-line bg-pv-surface-3 p-2.5">
                      <CardImage
                        src={rc.pokemonCard.imageUrl}
                        hiresSrc={rc.pokemonCard.imageUrlHires}
                        alt={rc.pokemonCard.name}
                        size="sm"
                        rarityTier={rc.rarityTier}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-bold text-pv-text">{rc.pokemonCard.name}</p>
                        <p className="mt-0.5 truncate text-[11px] text-pv-muted">{rc.pokemonCard.setName}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <RarityBadge rarity={rc.rarityTier} compact />
                          <span className="text-[12px] font-extrabold tabular-nums text-pv-text">
                            {formatMoneyCents(rc.pokemonCard.currentPrice)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-5 flex gap-2">
                  <Link
                    href={routes.collection.index}
                    className={buttonClassName({ variant: "primary", fullWidth: true })}
                  >
                    View in collection
                  </Link>
                  <Button
                    type="button"
                    variant="secondary"
                    fullWidth
                    onClick={() => setShowSummaryOverlay(false)}
                  >
                    Close
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
