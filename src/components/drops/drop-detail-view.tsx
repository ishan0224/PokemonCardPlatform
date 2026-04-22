"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { DropTierCard } from "./drop-tier-card";
import { Button, buttonClassName } from "@/components/ui/button";
import { Chip, type ChipTone } from "@/components/ui/chip";
import { StatTile } from "@/components/ui/stat-tile";
import { useDrop } from "@/hooks/use-drop";
import { useCountdown } from "@/hooks/use-countdown";
import { useAuth } from "@/hooks/use-auth";
import { routes } from "@/lib/routes";
import type { PackTier, DropStatus } from "@/lib/types";
import { ApiClientError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

function statusChipTone(status: DropStatus): ChipTone {
  if (status === "active") return "live";
  if (status === "upcoming") return "upcoming";
  if (status === "completed") return "completed";
  return "neutral";
}

function statusLabel(status: DropStatus): string {
  if (status === "active") return "Live";
  if (status === "upcoming") return "Upcoming";
  if (status === "completed") return "Completed";
  return "Cancelled";
}

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
  const countdownText = `${String(countdown.days).padStart(2, "0")}:${String(countdown.hours).padStart(
    2,
    "0"
  )}:${String(countdown.minutes).padStart(2, "0")}:${String(countdown.seconds).padStart(2, "0")}`;

  const onPurchase = async (tier: PackTier): Promise<void> => {
    if (authLoading) return;
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
    <section className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-pv-muted">Drop</p>
          <h1 className="mt-1 text-pv-h1">
            {drop ? `Drop ${drop.id.slice(0, 8)}` : "Loading…"}
          </h1>
          {drop ? (
            <p className="mt-1 text-[13px] text-pv-muted">
              Scheduled {formatDateTime(drop.scheduledAt)}
            </p>
          ) : null}
        </div>
        <Button type="button" variant="secondary" onClick={() => void refresh()}>
          Refresh
        </Button>
      </header>

      {loading ? (
        <p className="text-[13px] font-medium text-pv-muted">Loading drop…</p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-pv-sm border border-pv-accent/30 bg-[rgba(239,68,68,0.08)] p-3 text-[13px] font-medium text-[#fca5a5]"
        >
          {error}
        </p>
      ) : null}

      {drop ? (
        <>
          {/* META STRIP */}
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile
              label="Status"
              value={
                <Chip tone={statusChipTone(drop.status)} pulse={drop.status === "active"}>
                  {statusLabel(drop.status)}
                </Chip>
              }
              valueClassName="text-[14px]"
            />
            <StatTile
              label="Scheduled"
              value={formatDateTime(drop.scheduledAt)}
              valueClassName="text-[16px]"
            />
            <StatTile
              label="Countdown"
              value={<span className="tabular-nums">{countdownText}</span>}
              valueClassName="text-[18px]"
            />
            <StatTile
              label="Tiers"
              value={`${drop.tiers.length} available`}
              valueClassName="text-[16px]"
            />
          </section>

          {/* LAST PURCHASE BANNER */}
          {lastPurchase ? (
            <section className="rounded-pv-lg border border-pv-good/30 bg-pv-good-soft p-4">
              <p className="text-[13px] font-semibold text-pv-good">
                Purchase complete. Pack {lastPurchase.packId.slice(0, 8)} is ready.
              </p>
              <div className="mt-3 flex gap-2">
                <Link
                  href={routes.packs.reveal(lastPurchase.packId)}
                  className={buttonClassName({ variant: "gold" })}
                >
                  Reveal pack
                </Link>
                <Button type="button" variant="secondary" onClick={clearPurchaseResult}>
                  Dismiss
                </Button>
              </div>
            </section>
          ) : null}

          {!authLoading && !user ? (
            <div className="rounded-pv-lg border border-pv-warn/30 bg-[rgba(245,158,11,0.08)] p-4 text-[13px] font-medium text-pv-warn">
              Log in to purchase packs.{" "}
              <Link href={routes.auth.login} className="font-bold text-pv-text underline">
                Sign in
              </Link>
              .
            </div>
          ) : null}

          {/* TIER CARDS */}
          <section>
            <h2 className="mb-3 text-pv-h2">Pick a tier</h2>
            <div className="grid gap-4 md:grid-cols-3">
              {drop.tiers.map((tier) => (
                <DropTierCard
                  key={tier.dropPackId}
                  tier={tier}
                  countdownText={countdownText}
                  actionLabel="Buy pack"
                  actionLoading={purchasePendingTier === tier.tier}
                  actionDisabled={drop.status !== "active" || authLoading || !user}
                  onAction={() => void onPurchase(tier.tier)}
                />
              ))}
            </div>
          </section>

          {/* FAIRNESS PROOF STRIP */}
          <section className="rounded-pv-lg border border-pv-info/25 bg-[rgba(56,189,248,0.04)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[14px] font-bold text-pv-text">Provably fair</p>
                <p className="mt-0.5 text-[12px] text-pv-muted">
                  Every pack is deterministically generated from a committed server seed. Verify any
                  pack after the drop closes.
                </p>
              </div>
              <Link
                href={routes.fairness.verifyIndex}
                className={buttonClassName({ variant: "secondary", size: "sm" })}
              >
                How it works →
              </Link>
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}
