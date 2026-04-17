"use client";

import Link from "next/link";
import type { Drop } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { useCountdown } from "@/hooks/use-countdown";
import { DropStatusBadge } from "./drop-status-badge";
import { DropTierCard } from "./drop-tier-card";

export function DropListItem({ drop }: { drop: Drop }): JSX.Element {
  const countdown = useCountdown(drop.scheduledAt);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-black text-slate-900">Drop {drop.id.slice(0, 8)}</h2>
            <DropStatusBadge status={drop.status} />
          </div>
          <p className="mt-1 text-sm text-slate-600">Scheduled: {formatDateTime(drop.scheduledAt)}</p>
        </div>

        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-slate-500">Countdown</p>
          <p className="text-lg font-black text-slate-900">
            {countdown.days}d {String(countdown.hours).padStart(2, "0")}:
            {String(countdown.minutes).padStart(2, "0")}:
            {String(countdown.seconds).padStart(2, "0")}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {drop.tiers.map((tier) => (
          <DropTierCard key={tier.dropPackId} tier={tier} />
        ))}
      </div>

      <div className="mt-4 flex justify-end">
        <Link
          href={`/drops/${drop.id}`}
          className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-rose-700"
        >
          View Drop
        </Link>
      </div>
    </section>
  );
}
