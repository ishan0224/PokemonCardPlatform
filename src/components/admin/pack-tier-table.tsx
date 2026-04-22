import type { PackEconomicsBundle, PackTierEconomics } from "@/lib/types";
import {
  formatMoneyCents,
  formatPlainPercentBps,
  formatSignedMoneyCents
} from "@/lib/format";
import { RarityBadge } from "@/components/ui/rarity-badge";
import type { RarityTier } from "@/lib/types";

type PackTierTableProps = {
  tiers: PackTierEconomics[];
  portfolio: PackEconomicsBundle["portfolio"];
};

const TIER_RARITY: Record<string, RarityTier> = {
  standard: "common",
  premium: "rare",
  elite: "chase"
};

function edgeDeltaBps(actual: number | null, target: number): number | null {
  if (actual === null) return null;
  return actual - target;
}

function winRateFromBundle(tier: PackTierEconomics): string {
  // Proxy: share of price recovered by realised EV (no per-pack count exposed on the bundle).
  if (tier.packsPurchased === 0 || tier.actualEvCents === null || tier.priceCents === 0) return "—";
  const recovery = Math.min(100, Math.max(0, (tier.actualEvCents / tier.priceCents) * 100));
  return `${recovery.toFixed(1)}%`;
}

function marginPer1kLabel(tier: PackTierEconomics): string {
  if (tier.packsPurchased === 0) return "—";
  const per1k = (tier.sigmaMarginCents / tier.packsPurchased) * 1000;
  return formatMoneyCents(Math.abs(Math.round(per1k)));
}

export function PackTierTable({ tiers, portfolio: _portfolio }: PackTierTableProps): JSX.Element {
  return (
    <section className="overflow-hidden rounded-pv-lg border border-pv-line bg-pv-surface-2">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <h2 className="text-pv-h3">Pack tiers · window</h2>
        <span className="text-[12px] text-pv-muted">
          Target edge from <span className="font-mono">TARGET_HOUSE_EDGE_BPS</span>
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
              <th className="border-b border-pv-line px-4 py-3">Tier</th>
              <th className="border-b border-pv-line px-4 py-3 text-right">Price</th>
              <th className="border-b border-pv-line px-4 py-3 text-right">Packs</th>
              <th className="border-b border-pv-line px-4 py-3 text-right">Mean EV</th>
              <th className="border-b border-pv-line px-4 py-3 text-right">Win rate</th>
              <th className="border-b border-pv-line px-4 py-3 text-right">Target edge</th>
              <th className="border-b border-pv-line px-4 py-3 text-right">Achieved</th>
              <th className="border-b border-pv-line px-4 py-3 text-right">Δ (bps)</th>
              <th className="border-b border-pv-line px-4 py-3 text-right">Margin / 1k</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {tiers.map((tier) => {
              const deltaBps = edgeDeltaBps(tier.actualHouseEdgeBps, tier.targetHouseEdgeBps);
              const isIncident = deltaBps !== null && deltaBps < 0 && Math.abs(deltaBps) > 200;
              const achievedClass =
                tier.actualHouseEdgeBps === null
                  ? "text-pv-muted"
                  : tier.actualHouseEdgeBps >= tier.targetHouseEdgeBps - 50
                    ? "text-pv-good"
                    : "text-pv-accent";
              const deltaClass =
                deltaBps === null
                  ? "text-pv-muted"
                  : deltaBps >= 0
                    ? "text-pv-muted"
                    : "text-pv-accent";
              const marginClass =
                tier.sigmaMarginCents < 0
                  ? "text-pv-accent"
                  : tier.actualHouseEdgeBps !== null && tier.actualHouseEdgeBps >= tier.targetHouseEdgeBps - 50
                    ? "text-pv-gold"
                    : "text-pv-text";
              return (
                <tr
                  key={tier.tier}
                  className={`border-b border-pv-line last:border-b-0 ${
                    isIncident ? "bg-[rgba(239,68,68,0.05)]" : ""
                  }`}
                >
                  <td className="px-4 py-3">
                    <RarityBadge rarity={TIER_RARITY[tier.tier] ?? "common"} compact className="mr-2" />
                    <span className="font-semibold text-pv-text">{tier.displayName}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-pv-text">
                    {formatMoneyCents(tier.priceCents)}
                  </td>
                  <td className="px-4 py-3 text-right text-pv-text">
                    {tier.packsPurchased.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-pv-text">
                    {tier.actualEvCents === null ? "—" : formatMoneyCents(tier.actualEvCents)}
                  </td>
                  <td className="px-4 py-3 text-right text-pv-text">{winRateFromBundle(tier)}</td>
                  <td className="px-4 py-3 text-right text-pv-text">
                    {formatPlainPercentBps(tier.targetHouseEdgeBps)}
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold ${achievedClass}`}>
                    {tier.actualHouseEdgeBps === null
                      ? "—"
                      : formatPlainPercentBps(tier.actualHouseEdgeBps)}
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold ${deltaClass}`}>
                    {deltaBps === null
                      ? "—"
                      : `${deltaBps >= 0 ? "+" : ""}${Math.round(deltaBps)}`}
                  </td>
                  <td className={`px-4 py-3 text-right font-extrabold ${marginClass}`}>
                    {tier.packsPurchased === 0
                      ? "—"
                      : `${tier.sigmaMarginCents < 0 ? "−" : ""}${marginPer1kLabel(tier)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-pv-line px-4 py-3 text-[11px] text-pv-muted">
        <span>
          {tiers.filter((tier) => tier.packsPurchased > 0 && tier.sigmaMarginCents >= 0).length} of{" "}
          {tiers.filter((tier) => tier.packsPurchased > 0).length} tiers profitable.
        </span>
        <span className="font-mono text-pv-muted-2">
          source · platform_revenue ⋈ packs ⋈ pokemon_cards
        </span>
      </div>
    </section>
  );
}

