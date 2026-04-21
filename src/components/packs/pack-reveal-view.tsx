"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePackReveal } from "@/hooks/use-pack-reveal";
import { useAuth } from "@/hooks/use-auth";
import { Button, buttonClassName } from "@/components/ui/button";
import { CardImage } from "@/components/ui/card-image";
import { formatDateTime, formatMoneyCents, formatTierLabel } from "@/lib/format";
import { ApiClientError, type PackCard } from "@/lib/api-client";
import { routes } from "@/lib/routes";

const RevealSlotCardAnimated = dynamic(
  () => import("./reveal-slot-card-animated").then((module) => module.RevealSlotCardAnimated),
  {
    ssr: false,
    loading: () => <div className="min-h-[360px] rounded-2xl border border-pv-border bg-white" />
  }
);

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const onChange = (): void => {
      setPrefersReducedMotion(mediaQuery.matches);
    };

    onChange();
    mediaQuery.addEventListener("change", onChange);
    return () => {
      mediaQuery.removeEventListener("change", onChange);
    };
  }, []);

  return prefersReducedMotion;
}

export function PackRevealView({ packId }: { packId: string }): JSX.Element {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const prefersReducedMotion = usePrefersReducedMotion();
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [packBurstActive, setPackBurstActive] = useState(false);
  const wasAllRevealedRef = useRef(false);
  const burstTimerRef = useRef<number | null>(null);
  const { pack, loading, error, openPending, revealPendingSlot, slotOrder, revealedCardsBySlot, openPack, revealNext, revealSlot } =
    usePackReveal(packId);

  const unrevealedCount = slotOrder.filter((slot) => !revealedCardsBySlot[slot]).length;
  const canReveal = slotOrder.length > 0 && unrevealedCount > 0;
  const allRevealed = Boolean(pack?.opened) && slotOrder.length > 0 && unrevealedCount === 0;
  const revealedCards = useMemo<PackCard[]>(
    () => slotOrder.map((slot) => revealedCardsBySlot[slot]).filter((card): card is PackCard => Boolean(card)),
    [slotOrder, revealedCardsBySlot]
  );
  const totalPackMarketValue = useMemo(
    () => revealedCards.reduce((sum, card) => sum + card.pokemonCard.currentPrice, 0),
    [revealedCards]
  );
  const pricePaid = pack?.pricePaid ?? 0;
  const pnlAmount = totalPackMarketValue - pricePaid;
  const pnlLabel = pnlAmount > 0 ? "Gain" : pnlAmount < 0 ? "Loss" : "Break-even";
  const pnlPositive = pnlAmount >= 0;

  useEffect(() => {
    setSummaryOpen(false);
    setPackBurstActive(false);
    wasAllRevealedRef.current = false;
  }, [packId]);

  useEffect(() => {
    if (allRevealed && !wasAllRevealedRef.current) {
      setSummaryOpen(true);
    }
    wasAllRevealedRef.current = allRevealed;
  }, [allRevealed]);

  useEffect(() => {
    return () => {
      if (burstTimerRef.current !== null) {
        window.clearTimeout(burstTimerRef.current);
      }
    };
  }, []);

  const triggerPackBurst = (): void => {
    if (prefersReducedMotion) {
      return;
    }

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

  if (!authLoading && !user && !loading) {
    return (
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-medium text-amber-800">
        Login is required to access pack reveals. {" "}
        <Link href={routes.auth.login} className="font-bold underline">
          Sign in
        </Link>
        .
      </section>
    );
  }

  return (
    <section>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-slate-950">Pack Reveal</h1>
          <p className="mt-1 text-sm text-slate-600">Reveal each slot in sequence to preserve tension.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {pack ? (
            <Link href={routes.fairness.verify(pack.id)} className={buttonClassName({ variant: "secondary" })}>
              Verify this pack
            </Link>
          ) : null}
          <Link href={routes.drops.index} className={buttonClassName({ variant: "ghost" })}>
            Back to drops
          </Link>
        </div>
      </div>

      {loading ? <p className="text-sm font-medium text-slate-600">Loading pack...</p> : null}
      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{error}</p> : null}

      {pack ? (
        <div className="space-y-5">
          <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            {packBurstActive ? (
              <div className="pointer-events-none absolute inset-0 z-10">
                <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-rose-200/35 to-transparent" />
              </div>
            ) : null}
            <div className="relative z-20">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-black text-slate-900">Pack {pack.id.slice(0, 8)}</h2>
                <p className="text-sm font-semibold text-slate-600">{formatTierLabel(pack.tier)}</p>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-4">
                <div className="rounded-xl bg-slate-100 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Paid</p>
                  <p className="text-lg font-black text-slate-900">{formatMoneyCents(pack.pricePaid)}</p>
                </div>
                <div className="rounded-xl bg-slate-100 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Purchased</p>
                  <p className="text-sm font-bold text-slate-900">{formatDateTime(pack.purchasedAt)}</p>
                </div>
                <div className="rounded-xl bg-slate-100 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Opened</p>
                  <p className="text-sm font-bold text-slate-900">{pack.openedAt ? formatDateTime(pack.openedAt) : "Not yet"}</p>
                </div>
                <div className="rounded-xl bg-slate-100 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Unrevealed</p>
                  <p className="text-lg font-black text-slate-900">{unrevealedCount}</p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {!pack.opened ? (
                  <Button type="button" loading={openPending} onClick={() => void onOpen()}>
                    {openPending ? "Opening..." : "Open Pack"}
                  </Button>
                ) : null}

                {pack.opened ? (
                  <Button
                    type="button"
                    onClick={() => void revealNext()}
                    disabled={!canReveal || revealPendingSlot !== null}
                    className="border-transparent bg-rose-600 text-white hover:bg-rose-700"
                  >
                    {revealPendingSlot !== null ? "Revealing..." : canReveal ? "Reveal Next Slot" : "All Revealed"}
                  </Button>
                ) : null}

                {allRevealed ? (
                  <Button type="button" variant="secondary" onClick={() => setSummaryOpen(true)}>
                    View Summary
                  </Button>
                ) : null}
              </div>
            </div>
          </section>

          {pack.opened ? (
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
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
              Open the pack to initialize reveal slots.
            </div>
          )}
        </div>
      ) : null}

      {summaryOpen && pack && allRevealed ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pack-summary-title"
        >
          <section className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="pack-summary-title" className="text-xl font-black text-slate-950">
                  Pack Summary
                </h2>
                <p className="mt-1 text-sm text-slate-600">All cards revealed. Here is your final result.</p>
              </div>
              <Button type="button" variant="secondary" onClick={() => setSummaryOpen(false)}>
                Close
              </Button>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl bg-slate-100 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Price Paid</p>
                <p className="text-lg font-black text-slate-900">{formatMoneyCents(pricePaid)}</p>
              </div>
              <div className="rounded-xl bg-slate-100 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Total Pack Value</p>
                <p className="text-lg font-black text-slate-900">{formatMoneyCents(totalPackMarketValue)}</p>
              </div>
              <div className={`rounded-xl p-3 ${pnlPositive ? "bg-emerald-100" : "bg-rose-100"}`}>
                <p className={`text-xs uppercase tracking-wide ${pnlPositive ? "text-emerald-700" : "text-rose-700"}`}>
                  {pnlLabel}
                </p>
                <p className={`text-lg font-black ${pnlPositive ? "text-emerald-900" : "text-rose-900"}`}>
                  {pnlAmount > 0 ? "+" : pnlAmount < 0 ? "-" : ""}
                  {formatMoneyCents(Math.abs(pnlAmount))}
                </p>
              </div>
            </div>

            <div className="mt-5">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-600">All Cards</h3>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {revealedCards.map((card) => (
                  <div key={card.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex gap-3">
                      <CardImage
                        src={card.pokemonCard.imageUrl}
                        hiresSrc={card.pokemonCard.imageUrlHires}
                        alt={card.pokemonCard.name}
                        size="sm"
                        rarityTier={card.rarityTier}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-bold text-slate-900">{card.pokemonCard.name}</p>
                          <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-bold uppercase text-white">
                            {card.rarityTier}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-600">{card.pokemonCard.setName}</p>
                        <div className="mt-2 flex items-center justify-between text-sm">
                          <span className="font-medium text-slate-600">Market</span>
                          <span className="font-bold text-slate-900">{formatMoneyCents(card.pokemonCard.currentPrice)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Link href={routes.fairness.verify(pack.id)} className={buttonClassName({ variant: "primary" })}>
                Verify this pack
              </Link>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
