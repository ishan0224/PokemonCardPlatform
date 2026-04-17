"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { DropStatusBadge } from "./drop-status-badge";
import { DropTierCard } from "./drop-tier-card";
import { useDrop } from "@/hooks/use-drop";
import { useCountdown } from "@/hooks/use-countdown";
import { useAuth } from "@/hooks/use-auth";
import { formatDateTime } from "@/lib/format";
import type { PackTier } from "@/lib/types";
import { ApiClientError } from "@/lib/api-client";

export function DropDetailView({ dropId }: { dropId: string }): JSX.Element {
  const router = useRouter();
  const { user, refreshAuth } = useAuth();
  const {
    drop,
    loading,
    error,
    purchasePendingTier,
    lastPurchase,
    clearPurchaseResult,
    purchaseTier,
    refresh
  } = useDrop(dropId);
  const countdown = useCountdown(drop?.scheduledAt ?? new Date().toISOString());

  const onPurchase = async (tier: PackTier): Promise<void> => {
    if (!user) {
      router.push("/login");
      return;
    }

    try {
      await purchaseTier(tier);
      await refreshAuth();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        router.push("/login");
      }
    }
  };

  return (
    <section>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-slate-950">Drop Detail</h1>
          <p className="mt-1 text-sm text-slate-600">Track inventory in real time and secure your tier before sell-out.</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500 hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      {loading ? <p className="text-sm font-medium text-slate-600">Loading drop...</p> : null}
      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{error}</p> : null}

      {drop ? (
        <div className="space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black text-slate-900">Drop {drop.id.slice(0, 8)}</h2>
                <DropStatusBadge status={drop.status} />
              </div>
              <p className="text-sm font-semibold text-slate-600">{formatDateTime(drop.scheduledAt)}</p>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-4">
              <div className="rounded-xl bg-slate-100 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Days</p>
                <p className="text-xl font-black text-slate-900">{countdown.days}</p>
              </div>
              <div className="rounded-xl bg-slate-100 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Hours</p>
                <p className="text-xl font-black text-slate-900">{String(countdown.hours).padStart(2, "0")}</p>
              </div>
              <div className="rounded-xl bg-slate-100 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Minutes</p>
                <p className="text-xl font-black text-slate-900">{String(countdown.minutes).padStart(2, "0")}</p>
              </div>
              <div className="rounded-xl bg-slate-100 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">Seconds</p>
                <p className="text-xl font-black text-slate-900">{String(countdown.seconds).padStart(2, "0")}</p>
              </div>
            </div>
          </section>

          {lastPurchase ? (
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-semibold text-emerald-800">
                Purchase complete. Pack {lastPurchase.packId.slice(0, 8)} is ready.
              </p>
              <div className="mt-3 flex gap-2">
                <Link
                  href={`/packs/${lastPurchase.packId}/reveal`}
                  className="rounded-xl bg-emerald-700 px-3 py-2 text-sm font-bold text-white transition hover:bg-emerald-800"
                >
                  Reveal Pack
                </Link>
                <button
                  type="button"
                  onClick={clearPurchaseResult}
                  className="rounded-xl border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100"
                >
                  Dismiss
                </button>
              </div>
            </section>
          ) : null}

          {!user ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800">
              Login is required to purchase packs.{" "}
              <Link href="/login" className="font-bold underline">
                Sign in
              </Link>
              .
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-3">
            {drop.tiers.map((tier) => (
              <DropTierCard
                key={tier.dropPackId}
                tier={tier}
                actionLabel="Buy Pack"
                actionLoading={purchasePendingTier === tier.tier}
                actionDisabled={drop.status !== "active" || !user}
                onAction={() => void onPurchase(tier.tier)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
