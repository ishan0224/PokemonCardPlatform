import type { EconomicsSummary, PackTierEconomics } from "@/lib/types";
import { formatMoneyCents, formatPlainPercentBps, formatSignedMoneyCents } from "@/lib/format";
import { StatTile } from "@/components/ui/stat-tile";
import { PACK_TIERS_ORDER } from "./pack-tiers";

type EconomicsKpiStripProps = {
  summary: EconomicsSummary;
  tiers: PackTierEconomics[];
};

function tierMixLabel(summary: EconomicsSummary): string {
  if (summary.packsPurchased === 0) return "no packs sold";
  const parts = PACK_TIERS_ORDER.map((tier) => {
    const count = summary.packsPurchasedByTier.find((entry) => entry.tier === tier)?.count ?? 0;
    const pct = Math.round((count / summary.packsPurchased) * 100);
    return pct;
  });
  return `s/p/e · ${parts.join(" / ")}%`;
}

export function EconomicsKpiStrip({ summary, tiers: _tiers }: EconomicsKpiStripProps): JSX.Element {
  const takeRateLabel = `take rate ${formatPlainPercentBps(summary.takeRateBps)}`;
  const netTone = summary.netRevenueCents < 0 ? "bad" : "gold";

  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile
        label={`GMV (${summary.window.durationHours}h)`}
        value={formatMoneyCents(summary.gmvCents)}
        delta={`${summary.transactionRowCount.toLocaleString()} tx`}
        tone="muted"
      />
      <StatTile
        label="Net revenue"
        value={
          <span className={netTone === "gold" ? "text-pv-gold" : "text-pv-accent"}>
            {formatSignedMoneyCents(summary.netRevenueCents)}
          </span>
        }
        delta={takeRateLabel}
        tone={netTone}
      />
      <StatTile
        label="Unique buyers"
        value={summary.uniqueUsers.toLocaleString()}
        delta={`${summary.auctionsSettled.toLocaleString()} auctions settled`}
        tone="muted"
      />
      <StatTile
        label="Packs purchased"
        value={summary.packsPurchased.toLocaleString()}
        delta={tierMixLabel(summary)}
        tone="muted"
      />
    </section>
  );
}
