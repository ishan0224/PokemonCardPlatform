import type { PackTierEconomics } from "@/lib/types";
import { formatPlainPercentBps } from "@/lib/format";

type EconomicsIncidentBannerProps = {
  tiers: PackTierEconomics[];
  tiersLosingMoneyCount: number;
  incidentDeltaBps: number;
};

function isTierOutOfBand(tier: PackTierEconomics, deltaBps: number): boolean {
  if (tier.actualHouseEdgeBps === null) return false;
  return Math.abs(tier.actualHouseEdgeBps - tier.targetHouseEdgeBps) > deltaBps;
}

export function EconomicsIncidentBanner({
  tiers,
  tiersLosingMoneyCount,
  incidentDeltaBps
}: EconomicsIncidentBannerProps): JSX.Element | null {
  const outOfBandTiers = tiers.filter((tier) => isTierOutOfBand(tier, incidentDeltaBps));

  if (tiersLosingMoneyCount === 0 && outOfBandTiers.length === 0) return null;

  const losing = tiers.filter((tier) => tier.packsPurchased > 0 && tier.sigmaMarginCents < 0);
  const affected = losing.length > 0 ? losing : outOfBandTiers;
  const firstTier = affected[0];
  const deltaPp = firstTier && firstTier.actualHouseEdgeBps !== null
    ? (firstTier.actualHouseEdgeBps - firstTier.targetHouseEdgeBps) / 100
    : 0;

  return (
    <section
      className="rounded-pv-lg border border-pv-accent/35 bg-gradient-to-b from-[rgba(239,68,68,0.08)] to-transparent p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            aria-hidden="true"
            className="grid h-9 w-9 place-items-center rounded-[10px] bg-[rgba(239,68,68,0.14)] font-extrabold text-[#fca5a5]"
          >
            !
          </div>
          <div>
            <div className="text-pv-h3 text-[#fca5a5]">
              {firstTier ? `${firstTier.displayName} tier edge incident` : "Pack edge incident"}
            </div>
            <p className="mt-0.5 text-[12px] text-pv-muted">
              {firstTier && firstTier.actualHouseEdgeBps !== null ? (
                <>
                  Achieved {formatPlainPercentBps(firstTier.actualHouseEdgeBps)} vs. target{" "}
                  {formatPlainPercentBps(firstTier.targetHouseEdgeBps)} · delta{" "}
                  {deltaPp >= 0 ? "+" : "−"}
                  {Math.abs(deltaPp).toFixed(1)}pp · {affected.length} tier(s) affected
                </>
              ) : (
                <>
                  {tiersLosingMoneyCount} of {tiers.length} tier(s) out of corridor (threshold ±
                  {formatPlainPercentBps(incidentDeltaBps)}).
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex min-h-9 items-center rounded-[10px] border border-transparent px-3 py-1.5 text-[12px] font-bold text-pv-muted hover:bg-pv-surface-2 hover:text-pv-text"
          >
            Acknowledge
          </button>
          <button
            type="button"
            className="inline-flex min-h-9 items-center rounded-[10px] border border-pv-line bg-pv-surface-3 px-3 py-1.5 text-[12px] font-bold text-pv-text hover:border-pv-line-strong"
          >
            Open What-If
          </button>
        </div>
      </div>
    </section>
  );
}
