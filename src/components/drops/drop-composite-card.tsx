"use client";

import Image from "next/image";
import Link from "next/link";
import { CardShell } from "@/components/ui/card-shell";
import { Chip, type ChipTone } from "@/components/ui/chip";
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
  return `${formatMoneyCents(min)} – ${formatMoneyCents(max)}`;
}

function inventorySummary(drop: Drop): { remaining: number; total: number; soldOut: boolean } {
  const remaining = drop.tiers.reduce((sum, tier) => sum + tier.remainingInventory, 0);
  const total = drop.tiers.reduce((sum, tier) => sum + tier.totalInventory, 0);
  return { remaining, total, soldOut: total > 0 && remaining === 0 };
}

function statusChipTone(status: Drop["status"]): ChipTone {
  if (status === "active") return "live";
  if (status === "upcoming") return "upcoming";
  if (status === "completed") return "completed";
  return "neutral";
}

function statusLabel(status: Drop["status"]): string {
  if (status === "active") return "Live";
  if (status === "upcoming") return "Upcoming";
  if (status === "completed") return "Completed";
  return "Cancelled";
}

function resolveAction(
  status: Drop["status"],
  soldOut: boolean
): { label: string; variant: "primary" | "secondary" | "gold" } {
  if (soldOut) return { label: "View results", variant: "secondary" };
  if (status === "active") return { label: "Rip a pack", variant: "primary" };
  return { label: "View drop", variant: "secondary" };
}

export function DropCompositeCard({
  drop,
  countdownText,
  priority = false
}: DropCompositeCardProps): JSX.Element {
  const tiers = drop.tiers.map((tier) => tier.tier);
  const imagePath = dropPackImagePath(tiers);
  const imageDimensions = dropPackImageDimensions(tiers);
  const readableTiers = drop.tiers.map((tier) => formatTierLabel(tier.tier)).join(", ");
  const inventory = inventorySummary(drop);
  const { label, variant } = resolveAction(drop.status, inventory.soldOut);

  return (
    <Link
      href={routes.drops.detail(drop.id)}
      aria-label={`Open drop ${drop.id.slice(0, 8)} details — ${readableTiers}`}
      className="block h-full transition hover:-translate-y-0.5"
    >
      <article className="flex h-full flex-col overflow-hidden rounded-pv-lg border border-pv-line bg-pv-surface-2 transition-colors hover:border-pv-line-strong">
        {/* MEDIA */}
        <div
          className="relative flex aspect-square items-center justify-center overflow-hidden"
          style={{
            backgroundImage:
              "radial-gradient(60% 40% at 50% 40%, rgba(120,120,160,0.15), rgba(0,0,0,0)), linear-gradient(to bottom, #0f0f13, #0f0f13)"
          }}
        >
          <Image
            src={imagePath}
            alt={`Drop pack: ${readableTiers} tiers available`}
            width={imageDimensions.width}
            height={imageDimensions.height}
            priority={priority}
            sizes="(min-width: 1024px) 320px, (min-width: 768px) 44vw, 88vw"
            className="h-[78%] w-[78%] object-contain drop-shadow-[0_24px_48px_rgba(0,0,0,0.5)]"
          />
          <span className="absolute left-3 top-3">
            <Chip tone={statusChipTone(drop.status)} pulse={drop.status === "active"}>
              {statusLabel(drop.status)}
            </Chip>
          </span>
          <span className="absolute right-3 top-3">
            {inventory.soldOut ? (
              <Chip tone="sold-out">Sold out</Chip>
            ) : (
              <Chip tone="neutral">
                {inventory.remaining} / {inventory.total}
              </Chip>
            )}
          </span>
        </div>

        {/* BODY */}
        <div className="flex-1 px-3.5 py-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted">
            {tierSummary(drop)}
          </p>
          <h3 className="mt-1 text-[14px] font-bold text-pv-text">Drop {drop.id.slice(0, 8)}</h3>
          {countdownText ? (
            <p className="mt-1 text-[12px] tabular-nums text-pv-muted">
              {drop.status === "upcoming" ? "Starts in" : "Ends in"} {countdownText}
            </p>
          ) : null}
        </div>

        {/* FOOTER */}
        <div className="flex items-center justify-between gap-2 border-t border-pv-line px-3.5 py-3">
          <span className="text-[12px] tabular-nums text-pv-muted">{priceSummary(drop)}</span>
          <span className={buttonClassName({ variant, size: "sm" })} aria-hidden="true">
            {label}
          </span>
        </div>
      </article>
    </Link>
  );
}
