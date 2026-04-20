import type { PackEconomicsBundle, PackTierEconomics } from "@/lib/types";
import {
  formatMoneyCents,
  formatPlainPercentBps,
  formatSignedMoneyCents
} from "@/lib/format";
import { TIER_STYLES } from "./styles";

type PackTierTableProps = {
  tiers: PackTierEconomics[];
  portfolio: PackEconomicsBundle["portfolio"];
};

function marginSpreadBar(tier: PackTierEconomics): JSX.Element {
  if (tier.worstMarginCents === null || tier.bestMarginCents === null || tier.packsPurchased === 0) {
    return (
      <div className="font-mono text-[10px] text-slate-500">
        no packs purchased
      </div>
    );
  }

  const negativeShare = tier.worstMarginCents < 0 ? 100 : 0;
  const positiveShare = tier.bestMarginCents > 0 ? 100 - negativeShare : 0;

  return (
    <div>
      <div className="font-mono text-[10px] text-slate-500">
        worst <span className="text-rose-600">{formatSignedMoneyCents(tier.worstMarginCents)}</span> · best{" "}
        <span className={tier.bestMarginCents >= 0 ? "text-emerald-600" : "text-amber-600"}>
          {formatSignedMoneyCents(tier.bestMarginCents)}
        </span>
      </div>
      <div className="mt-1 flex h-2 w-48 overflow-hidden rounded-full bg-slate-100">
        {negativeShare > 0 ? <div className="bg-rose-500" style={{ width: `${negativeShare}%` }} /> : null}
        {positiveShare > 0 ? <div className="bg-emerald-500" style={{ width: `${positiveShare}%` }} /> : null}
      </div>
    </div>
  );
}

export function PackTierTable({ tiers, portfolio }: PackTierTableProps): JSX.Element {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 p-6">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">Pack tier profitability</h2>
          <p className="mt-1 text-xs text-slate-500">
            Theoretical EV = rarity weights × live card anchors. Actual EV = mean <span className="font-mono">price − pack_margin</span> per purchased pack.
            House edge = (price − EV) / price.
          </p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="font-mono text-left text-[10px] uppercase tracking-wider text-slate-500">
              <th className="px-6 py-3 font-medium">Tier</th>
              <th className="px-4 py-3 text-right font-medium">Price</th>
              <th className="px-4 py-3 text-right font-medium">Packs</th>
              <th className="px-4 py-3 text-right font-medium">Theoretical EV</th>
              <th className="px-4 py-3 text-right font-medium">Actual EV</th>
              <th className="px-4 py-3 text-right font-medium">Theo. edge</th>
              <th className="px-4 py-3 text-right font-medium">Actual edge</th>
              <th className="px-4 py-3 font-medium">Margin spread</th>
              <th className="px-4 py-3 text-right font-medium">Σ margin</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {tiers.map((tier, index) => {
              const style = TIER_STYLES[tier.tier];
              const rowClass = index % 2 === 0 ? "" : "bg-slate-50/60";
              const actualEdgeClass =
                tier.actualHouseEdgeBps === null
                  ? "text-slate-500"
                  : tier.actualHouseEdgeBps < 0
                  ? "text-rose-600"
                  : tier.actualHouseEdgeBps < tier.targetHouseEdgeBps / 2
                  ? "text-amber-600"
                  : "text-emerald-600";
              return (
                <tr key={tier.tier} className={`border-t border-slate-100 ${rowClass}`}>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className={`h-8 w-6 rounded-sm bg-gradient-to-br ${style.gradientClass}`} />
                      <div>
                        <div className="font-semibold text-slate-900">{tier.displayName}</div>
                        <div className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
                          target {formatPlainPercentBps(tier.targetHouseEdgeBps)}
                        </div>
                        <div className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
                          anchors {tier.anchorSource}
                          {tier.anchorFallbackRarities && tier.anchorFallbackRarities.length > 0
                            ? ` (${tier.anchorFallbackRarities.join(",")})`
                            : ""}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-right">{formatMoneyCents(tier.priceCents)}</td>
                  <td className="px-4 py-4 text-right">{tier.packsPurchased}</td>
                  <td className="px-4 py-4 text-right">{formatMoneyCents(tier.theoreticalEvCents)}</td>
                  <td className="px-4 py-4 text-right">
                    {tier.actualEvCents === null ? "—" : formatMoneyCents(tier.actualEvCents)}
                  </td>
                  <td className="px-4 py-4 text-right text-slate-700">
                    {formatPlainPercentBps(tier.theoreticalHouseEdgeBps)}
                  </td>
                  <td className={`px-4 py-4 text-right font-semibold ${actualEdgeClass}`}>
                    {tier.actualHouseEdgeBps === null ? "—" : formatPlainPercentBps(tier.actualHouseEdgeBps)}
                  </td>
                  <td className="px-4 py-4">{marginSpreadBar(tier)}</td>
                  <td
                    className={`px-4 py-4 text-right font-semibold ${
                      tier.sigmaMarginCents < 0 ? "text-rose-600" : tier.sigmaMarginCents > 0 ? "text-emerald-600" : "text-slate-600"
                    }`}
                  >
                    {formatSignedMoneyCents(tier.sigmaMarginCents)}
                  </td>
                </tr>
              );
            })}

            <tr className="border-t-2 border-slate-200 bg-slate-50">
              <td className="px-6 py-4 font-semibold">Portfolio</td>
              <td className="px-4 py-4 text-right text-slate-500">—</td>
              <td className="px-4 py-4 text-right font-semibold">{portfolio.packsPurchased}</td>
              <td className="px-4 py-4 text-right text-slate-500">—</td>
              <td className="px-4 py-4 text-right text-slate-500">—</td>
              <td className="px-4 py-4 text-right text-slate-700">
                {formatPlainPercentBps(portfolio.theoreticalHouseEdgeBps)}
              </td>
              <td
                className={`px-4 py-4 text-right font-bold ${
                  portfolio.actualHouseEdgeBps === null
                    ? "text-slate-500"
                    : portfolio.actualHouseEdgeBps < 0
                    ? "text-rose-600"
                    : "text-emerald-600"
                }`}
              >
                {portfolio.actualHouseEdgeBps === null ? "—" : formatPlainPercentBps(portfolio.actualHouseEdgeBps)}
              </td>
              <td className="px-4 py-4 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                {portfolio.sigmaMarginCents < 0 ? "losing money" : portfolio.sigmaMarginCents > 0 ? "sustainable" : "—"}
              </td>
              <td
                className={`px-4 py-4 text-right font-black ${
                  portfolio.sigmaMarginCents < 0 ? "text-rose-600" : portfolio.sigmaMarginCents > 0 ? "text-emerald-600" : "text-slate-600"
                }`}
              >
                {formatSignedMoneyCents(portfolio.sigmaMarginCents)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3 text-[11px] text-slate-500">
        <span>
          {tiers.filter((tier) => tier.packsPurchased > 0 && tier.sigmaMarginCents >= 0).length} of{" "}
          {tiers.filter((tier) => tier.packsPurchased > 0).length} tiers profitable.
        </span>
        <span className="font-mono">source · platform_revenue ⋈ packs ⋈ pokemon_cards</span>
      </div>
    </section>
  );
}
