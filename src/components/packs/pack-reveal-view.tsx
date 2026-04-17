"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { RevealSlotCard } from "./reveal-slot-card";
import { usePackReveal } from "@/hooks/use-pack-reveal";
import { useAuth } from "@/hooks/use-auth";
import { formatDateTime, formatMoneyCents, formatTierLabel } from "@/lib/format";
import { ApiClientError, type PackCard } from "@/lib/api-client";

export function PackRevealView({ packId }: { packId: string }): JSX.Element {
  const router = useRouter();
  const { user } = useAuth();
  const [summaryOpen, setSummaryOpen] = useState(false);
  const wasAllRevealedRef = useRef(false);
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
    wasAllRevealedRef.current = false;
  }, [packId]);

  useEffect(() => {
    if (allRevealed && !wasAllRevealedRef.current) {
      setSummaryOpen(true);
    }
    wasAllRevealedRef.current = allRevealed;
  }, [allRevealed]);

  useEffect(() => {
    if (!summaryOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setSummaryOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [summaryOpen]);

  const onOpen = async (): Promise<void> => {
    try {
      await openPack();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        router.push("/login");
      }
    }
  };

  if (!user && !loading) {
    return (
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-medium text-amber-800">
        Login is required to access pack reveals.{" "}
        <Link href="/login" className="font-bold underline">
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
        <Link
          href="/drops"
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500 hover:bg-slate-50"
        >
          Back to drops
        </Link>
      </div>

      {loading ? <p className="text-sm font-medium text-slate-600">Loading pack...</p> : null}
      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{error}</p> : null}

      {pack ? (
        <div className="space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
                <button
                  type="button"
                  onClick={() => void onOpen()}
                  disabled={openPending}
                  className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
                    openPending
                      ? "cursor-not-allowed bg-slate-200 text-slate-500"
                      : "bg-slate-900 text-white hover:bg-slate-700"
                  }`}
                >
                  {openPending ? "Opening..." : "Open Pack"}
                </button>
              ) : null}

              {pack.opened ? (
                <button
                  type="button"
                  onClick={() => void revealNext()}
                  disabled={!canReveal || revealPendingSlot !== null}
                  className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
                    !canReveal || revealPendingSlot !== null
                      ? "cursor-not-allowed bg-slate-200 text-slate-500"
                      : "bg-rose-600 text-white hover:bg-rose-700"
                  }`}
                >
                  {revealPendingSlot !== null ? "Revealing..." : canReveal ? "Reveal Next Slot" : "All Revealed"}
                </button>
              ) : null}

              {allRevealed ? (
                <button
                  type="button"
                  onClick={() => setSummaryOpen(true)}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 transition hover:border-slate-500 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2"
                >
                  View Summary
                </button>
              ) : null}
            </div>
          </section>

          {pack.opened ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {slotOrder.map((slot) => (
                <RevealSlotCard
                  key={slot}
                  slotNumber={slot}
                  card={revealedCardsBySlot[slot]}
                  pending={revealPendingSlot === slot}
                  onReveal={() => void revealSlot(slot)}
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
          <section className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="pack-summary-title" className="text-xl font-black text-slate-950">
                  Pack Summary
                </h2>
                <p className="mt-1 text-sm text-slate-600">All cards revealed. Here is your final result.</p>
              </div>
              <button
                type="button"
                onClick={() => setSummaryOpen(false)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-slate-500 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2"
              >
                Close
              </button>
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
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold text-slate-900">{card.pokemonCard.name}</p>
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
                ))}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
