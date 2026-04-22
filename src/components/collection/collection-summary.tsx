import { StatTile } from "@/components/ui/stat-tile";
import { formatMoneyCents } from "@/lib/format";
import type { CollectionPortfolio } from "@/lib/api-client";

/**
 * Portfolio header — matches demo/collection.html
 *   crumb "Your portfolio" + h1 card-count + right cluster of three stat tiles
 *   (Total value, Cost basis, Realized/Unrealized P&L).
 */
export function CollectionSummary({
  portfolio
}: {
  portfolio: CollectionPortfolio | null;
}): JSX.Element {
  if (!portfolio) {
    return (
      <section
        className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-4"
        role="status"
        aria-live="polite"
      >
        <p className="text-[13px] font-medium text-pv-muted">Loading portfolio…</p>
      </section>
    );
  }

  const pnlTone: "good" | "bad" = portfolio.totalPnl >= 0 ? "good" : "bad";
  const pnlSign = portfolio.totalPnl >= 0 ? "+" : "-";
  const pnlLabel = `${pnlSign}${formatMoneyCents(Math.abs(portfolio.totalPnl))}`;

  return (
    <section className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-[0.05em] text-pv-muted">
            Your portfolio
          </p>
          <h1 className="mt-1 text-pv-h1">
            {portfolio.totalCards} card{portfolio.totalCards === 1 ? "" : "s"}
          </h1>
        </div>
        <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3 sm:max-w-[720px]">
          <StatTile
            label="Total value"
            value={formatMoneyCents(portfolio.totalMarketValue)}
            delta="Market · live"
            tone="muted"
          />
          <StatTile
            label="Cost basis"
            value={formatMoneyCents(portfolio.totalAcquisitionValue)}
            delta="Acquisition total"
            tone="muted"
          />
          <StatTile
            label="Unrealized P&L"
            value={<span className={pnlTone === "good" ? "text-pv-good" : "text-pv-accent"}>{pnlLabel}</span>}
            delta={pnlTone === "good" ? "In the green" : "In the red"}
            tone={pnlTone}
          />
        </div>
      </div>
    </section>
  );
}
