"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { DropTierCard } from "./drop-tier-card";
import { Button, buttonClassName } from "@/components/ui/button";
import { useDrop } from "@/hooks/use-drop";
import { useCountdown } from "@/hooks/use-countdown";
import { useAuth } from "@/hooks/use-auth";
import { routes } from "@/lib/routes";
import type { PackTier } from "@/lib/types";
import { ApiClientError } from "@/lib/api-client";

export function DropDetailView({ dropId }: { dropId: string }): JSX.Element {
  const router = useRouter();
  const { user, refreshAuth, loading: authLoading } = useAuth();
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
  const countdownText = `${String(countdown.days).padStart(2, "0")}:${String(countdown.hours).padStart(2, "0")}:${String(
    countdown.minutes
  ).padStart(2, "0")}:${String(countdown.seconds).padStart(2, "0")}`;

  const onPurchase = async (tier: PackTier): Promise<void> => {
    if (authLoading) {
      return;
    }

    if (!user) {
      router.push(routes.auth.login);
      return;
    }

    try {
      await purchaseTier(tier);
      await refreshAuth();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        router.push(routes.auth.login);
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
        <Button type="button" variant="secondary" onClick={() => void refresh()}>
          Refresh
        </Button>
      </div>

      {loading ? <p className="text-sm font-medium text-slate-600">Loading drop...</p> : null}
      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{error}</p> : null}

      {drop ? (
        <div className="space-y-5">
          {lastPurchase ? (
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-semibold text-emerald-800">
                Purchase complete. Pack {lastPurchase.packId.slice(0, 8)} is ready.
              </p>
              <div className="mt-3 flex gap-2">
                <Link
                  href={routes.packs.reveal(lastPurchase.packId)}
                  className={buttonClassName({ variant: "primary" })}
                >
                  Reveal Pack
                </Link>
                <Button type="button" variant="secondary" onClick={clearPurchaseResult}>
                  Dismiss
                </Button>
              </div>
            </section>
          ) : null}

          {!authLoading && !user ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800">
              Login is required to purchase packs.{" "}
              <Link href={routes.auth.login} className="font-bold underline">
                Sign in
              </Link>
              .
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-3">
            {drop.tiers.map((tier) => (
              <DropTierCard
                key={tier.dropPackId}
                tier={tier}
                countdownText={countdownText}
                actionLabel="Buy Pack"
                actionLoading={purchasePendingTier === tier.tier}
                actionDisabled={drop.status !== "active" || authLoading || !user}
                onAction={() => void onPurchase(tier.tier)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
