"use client";

import Link from "next/link";
import type { Drop } from "@/lib/api-client";
import { useCountdown } from "@/hooks/use-countdown";
import { routes } from "@/lib/routes";
import { DropTierCard } from "./drop-tier-card";

export function DropListItem({ drop }: { drop: Drop }): JSX.Element {
  const countdown = useCountdown(drop.scheduledAt);
  const countdownText = `${String(countdown.days).padStart(2, "0")}:${String(countdown.hours).padStart(2, "0")}:${String(
    countdown.minutes
  ).padStart(2, "0")}:${String(countdown.seconds).padStart(2, "0")}`;

  return (
    <section className="rounded-2xl border border-pv-border bg-pv-parchment-soft/20 p-3">
      <div className="grid grid-cols-1 gap-4">
        {drop.tiers.map((tier) => (
          <Link key={tier.dropPackId} href={routes.drops.detail(drop.id)} className="block h-full" aria-label={`Open ${drop.id.slice(0, 8)} detail`}>
            <DropTierCard
              tier={tier}
              countdownText={countdownText}
              imageSize={tier.tier === "standard" ? "xl" : "lg"}
              imageZoom={tier.tier === "standard" ? 2.1 : 1.55}
            />
          </Link>
        ))}
      </div>
    </section>
  );
}
