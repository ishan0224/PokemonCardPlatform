import type { PackTierEconomics } from "@/lib/types";
import { formatPlainPercentBps } from "@/lib/format";

type EconomicsIncidentBannerProps = {
  tiers: PackTierEconomics[];
  tiersLosingMoneyCount: number;
  incidentDeltaBps: number;
};

function isTierOutOfBand(tier: PackTierEconomics, deltaBps: number): boolean {
  if (tier.actualHouseEdgeBps === null) {
    return false;
  }
  return Math.abs(tier.actualHouseEdgeBps - tier.targetHouseEdgeBps) > deltaBps;
}

export function EconomicsIncidentBanner({
  tiers,
  tiersLosingMoneyCount,
  incidentDeltaBps
}: EconomicsIncidentBannerProps): JSX.Element | null {
  const outOfBandTiers = tiers.filter((tier) => isTierOutOfBand(tier, incidentDeltaBps));

  if (tiersLosingMoneyCount === 0 && outOfBandTiers.length === 0) {
    return null;
  }

  const losing = tiers.filter((tier) => tier.packsPurchased > 0 && tier.sigmaMarginCents < 0);

  return (
    <div className="rounded-2xl border border-rose-200 bg-gradient-to-r from-rose-50 via-rose-50 to-white p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-100 text-rose-700">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-rose-600">critical · open</span>
            <span className="rounded-full border border-rose-200 bg-white px-2 py-0.5 text-[10px] font-bold uppercase text-rose-700">
              pack economics out of corridor
            </span>
          </div>
          <h3 className="mt-1 text-base font-bold text-rose-950">
            {tiersLosingMoneyCount > 0
              ? `${tiersLosingMoneyCount} of ${tiers.length} tiers are losing money in this window.`
              : `${outOfBandTiers.length} tier(s) diverge from the target house edge.`}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-rose-900/80">
            {losing.length > 0
              ? losing
                  .map(
                    (tier) =>
                      `${tier.displayName} actual edge ${formatPlainPercentBps(tier.actualHouseEdgeBps ?? 0)} vs target ${formatPlainPercentBps(tier.targetHouseEdgeBps)}`
                  )
                  .join(" · ")
              : outOfBandTiers
                  .map(
                    (tier) =>
                      `${tier.displayName} actual edge ${formatPlainPercentBps(tier.actualHouseEdgeBps ?? 0)} vs target ${formatPlainPercentBps(tier.targetHouseEdgeBps)}`
                  )
                  .join(" · ")}
            . Fees cannot offset pack losses — check card anchor prices and rarity weights.
          </p>
        </div>
      </div>
    </div>
  );
}
