import type { EconomicsSummary, PackTierEconomics } from "@/lib/types";
import { formatMoneyCents, formatPlainPercentBps, formatSignedMoneyCents } from "@/lib/format";
import { KpiCard } from "./kpi-card";
import { RevenueStreamBar } from "./revenue-stream-bar";
import { STREAM_STYLES, TIER_STYLES } from "./styles";
import { PACK_TIERS_ORDER } from "./pack-tiers";

type EconomicsKpiStripProps = {
  summary: EconomicsSummary;
  tiers: PackTierEconomics[];
};

export function EconomicsKpiStrip({ summary, tiers }: EconomicsKpiStripProps): JSX.Element {
  const packStream = summary.revenueByStream.find((entry) => entry.stream === "pack_margin");
  const auctionStream = summary.revenueByStream.find((entry) => entry.stream === "auction_fee");
  const tradeStream = summary.revenueByStream.find((entry) => entry.stream === "trade_fee");

  const netVariant = summary.netRevenueCents < 0 ? "critical" : summary.netRevenueCents > 0 ? "positive" : "default";
  const netBadgeTone = summary.netRevenueCents < 0 ? "critical" : "positive";
  const packsBadgeTone = tiers.some((tier) => tier.packsPurchased > 0 && tier.sigmaMarginCents < 0) ? "critical" : "neutral";

  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <KpiCard
        label="Gross merchandise value"
        value={formatMoneyCents(summary.gmvCents)}
        badge={{ label: "window", tone: "neutral" }}
        caption={
          <span>
            packs {formatMoneyCents(summary.gmvPackCents)} · trades {formatMoneyCents(summary.gmvTradeCents)} · auctions {formatMoneyCents(summary.gmvAuctionCents)}
          </span>
        }
      />

      <KpiCard
        label="Platform net revenue"
        value={formatSignedMoneyCents(summary.netRevenueCents)}
        variant={netVariant}
        badge={{
          label: summary.netRevenueCents < 0 ? "critical" : "clean",
          tone: netBadgeTone
        }}
        caption={
          <span>
            take rate {formatPlainPercentBps(summary.takeRateBps)} of GMV
          </span>
        }
      >
        <div className="space-y-2">
          <RevenueStreamBar breakdown={summary.revenueByStream} />
          <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">
            <span>
              <span className={`mr-1 inline-block h-2 w-2 rounded-sm ${STREAM_STYLES.pack_margin.swatchClass}`} />
              Pack {formatSignedMoneyCents(packStream?.totalCents ?? 0)}
            </span>
            <span>
              <span className={`mr-1 inline-block h-2 w-2 rounded-sm ${STREAM_STYLES.auction_fee.swatchClass}`} />
              Auc {formatSignedMoneyCents(auctionStream?.totalCents ?? 0)}
            </span>
            <span>
              <span className={`mr-1 inline-block h-2 w-2 rounded-sm ${STREAM_STYLES.trade_fee.swatchClass}`} />
              Trade {formatSignedMoneyCents(tradeStream?.totalCents ?? 0)}
            </span>
          </div>
        </div>
      </KpiCard>

      <KpiCard
        label="Unique users"
        value={summary.uniqueUsers.toLocaleString()}
        badge={{ label: "ledger", tone: "neutral" }}
        caption={
          <span>
            {summary.transactionRowCount.toLocaleString()} tx · {summary.window.durationHours}h window
          </span>
        }
      />

      <KpiCard
        label="Packs purchased"
        value={summary.packsPurchased.toLocaleString()}
        badge={{
          label: packsBadgeTone === "critical" ? "tier bleed" : "window",
          tone: packsBadgeTone
        }}
        caption={
          tiers.some((tier) => tier.packsPurchased > 0) ? (
            <span>mean margin {formatSignedMoneyCents(Math.round(summary.packsPurchased > 0 ? (packStream?.totalCents ?? 0) / summary.packsPurchased : 0))} / pack</span>
          ) : (
            <span>no packs purchased in window</span>
          )
        }
      >
        <div className="space-y-1.5 text-xs">
          {PACK_TIERS_ORDER.map((tier) => {
            const count = summary.packsPurchasedByTier.find((entry) => entry.tier === tier)?.count ?? 0;
            const percent = summary.packsPurchased === 0 ? 0 : (count / summary.packsPurchased) * 100;
            const style = TIER_STYLES[tier];
            return (
              <div key={tier} className="flex items-center gap-2">
                <span className="w-16 text-slate-500">{style.label}</span>
                <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`absolute inset-y-0 left-0 rounded-full bg-gradient-to-r ${style.gradientClass}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <span className="w-8 text-right tabular-nums text-slate-700">{count}</span>
              </div>
            );
          })}
        </div>
      </KpiCard>

      <KpiCard
        label="Auctions settled"
        value={summary.auctionsSettled.toLocaleString()}
        badge={{
          label: summary.auctionsSettled === 0 ? "idle" : "clean",
          tone: summary.auctionsSettled === 0 ? "neutral" : "positive"
        }}
        caption={
          <span>
            avg {formatMoneyCents(summary.auctionAverageWinningBidCents)} · max {formatMoneyCents(summary.auctionMaxWinningBidCents)}
          </span>
        }
      >
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px]">
          <div className="flex justify-between text-slate-500">
            <span>Auction fees captured</span>
            <span className="font-semibold text-emerald-600 tabular-nums">
              {formatSignedMoneyCents(auctionStream?.totalCents ?? 0)}
            </span>
          </div>
          <div className="mt-1 flex justify-between text-slate-500">
            <span>Trade fees captured</span>
            <span className="font-semibold text-emerald-600 tabular-nums">
              {formatSignedMoneyCents(tradeStream?.totalCents ?? 0)}
            </span>
          </div>
        </div>
      </KpiCard>
    </section>
  );
}
