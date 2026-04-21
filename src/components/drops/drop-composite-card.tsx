"use client";

import Image from "next/image";
import Link from "next/link";
import { CardShell } from "@/components/ui/card-shell";
import { buttonClassName } from "@/components/ui/button";
import type { Drop } from "@/lib/api-client";
import { dropPackImageDimensions, dropPackImagePath } from "@/lib/drop-pack-image";
import { formatMoneyCents, formatTierLabel } from "@/lib/format";
import { routes } from "@/lib/routes";

type DropCompositeCardProps = {
  drop: Drop;
  countdownText?: string;
  priority?: boolean;
};

function tierSummary(drop: Drop): string {
  const tierLabels = drop.tiers.map((tier) => formatTierLabel(tier.tier));
  if (tierLabels.length <= 2) {
    return tierLabels.join(" · ");
  }
  return `${tierLabels[0]} + ${tierLabels.length - 1} more`;
}

function priceSummary(drop: Drop): string {
  const prices = drop.tiers.map((tier) => tier.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === max) {
    return formatMoneyCents(min);
  }
  return `${formatMoneyCents(min)} - ${formatMoneyCents(max)}`;
}

function inventorySummary(drop: Drop): string {
  const remaining = drop.tiers.reduce((sum, tier) => sum + tier.remainingInventory, 0);
  const total = drop.tiers.reduce((sum, tier) => sum + tier.totalInventory, 0);
  return `${remaining} / ${total}`;
}

function statusChipClassName(status: Drop["status"]): string {
  if (status === "active") {
    return "bg-emerald-100 text-emerald-800";
  }
  if (status === "upcoming") {
    return "bg-amber-100 text-amber-900";
  }
  return "bg-slate-200 text-slate-700";
}

function statusLabel(status: Drop["status"]): string {
  if (status === "active") {
    return "LIVE";
  }
  if (status === "upcoming") {
    return "UPCOMING";
  }
  return "COMPLETED";
}

export function DropCompositeCard({ drop, countdownText, priority = false }: DropCompositeCardProps): JSX.Element {
  const tiers = drop.tiers.map((tier) => tier.tier);
  const imagePath = dropPackImagePath(tiers);
  const imageDimensions = dropPackImageDimensions(tiers);
  const readableTiers = drop.tiers.map((tier) => formatTierLabel(tier.tier)).join(", ");

  const header = (
    <div className="flex items-start justify-between gap-2">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-pv-muted">{tierSummary(drop)}</p>
        <h3 className="mt-1 text-base font-black text-pv-ink">Drop {drop.id.slice(0, 8)}</h3>
      </div>
      <span className={`rounded-full px-2 py-1 text-xs font-bold ${statusChipClassName(drop.status)}`}>{statusLabel(drop.status)}</span>
    </div>
  );

  const media = (
    <div className="relative mx-auto w-full max-w-[420px] overflow-hidden rounded-xl border border-pv-border bg-pv-parchment-soft">
      <Image
        src={imagePath}
        alt={`Drop pack: ${readableTiers} tiers available`}
        width={imageDimensions.width}
        height={imageDimensions.height}
        priority={priority}
        sizes="(min-width: 1024px) 380px, (min-width: 768px) 44vw, 88vw"
        className="h-auto w-full object-contain"
      />
      {countdownText ? (
        <span className="absolute right-2 top-2 rounded-lg bg-black/45 px-2 py-1 text-xs font-bold text-white">{countdownText}</span>
      ) : null}
    </div>
  );

  const body = (
    <div className="grid grid-cols-2 gap-2 text-sm text-pv-muted">
      <p>
        Price range
        <span className="mt-0.5 block font-semibold text-pv-ink">{priceSummary(drop)}</span>
      </p>
      <p>
        Inventory
        <span className="mt-0.5 block font-semibold text-pv-ink">{inventorySummary(drop)}</span>
      </p>
    </div>
  );

  const actions = <span className={buttonClassName({ variant: "secondary", size: "sm", fullWidth: true })}>View drop</span>;

  return (
    <Link href={routes.drops.detail(drop.id)} aria-label={`Open drop ${drop.id.slice(0, 8)} details`} className="block h-full">
      <CardShell header={header} media={media} body={body} actions={actions} variant="surface" className="min-h-[430px]" />
    </Link>
  );
}
