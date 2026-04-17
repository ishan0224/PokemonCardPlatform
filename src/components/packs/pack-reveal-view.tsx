"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { RevealSlotCard } from "./reveal-slot-card";
import { usePackReveal } from "@/hooks/use-pack-reveal";
import { useAuth } from "@/hooks/use-auth";
import { formatDateTime, formatMoneyCents, formatTierLabel } from "@/lib/format";
import { ApiClientError } from "@/lib/api-client";

export function PackRevealView({ packId }: { packId: string }): JSX.Element {
  const router = useRouter();
  const { user } = useAuth();
  const { pack, loading, error, openPending, revealPendingSlot, slotOrder, revealedCardsBySlot, openPack, revealNext, revealSlot } =
    usePackReveal(packId);

  const unrevealedCount = slotOrder.filter((slot) => !revealedCardsBySlot[slot]).length;
  const canReveal = slotOrder.length > 0 && unrevealedCount > 0;

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
    </section>
  );
}
