import { formatMoneyCents } from "@/lib/format";
import type { CollectionPortfolio } from "@/lib/api-client";

export function CollectionSummary({ portfolio }: { portfolio: CollectionPortfolio | null }): JSX.Element {
  if (!portfolio) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-medium text-slate-600">Loading portfolio...</p>
      </section>
    );
  }

  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs uppercase tracking-wide text-slate-500">Total Cards</p>
        <p className="mt-1 text-2xl font-black text-slate-900">{portfolio.totalCards}</p>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs uppercase tracking-wide text-slate-500">Acquisition Value</p>
        <p className="mt-1 text-2xl font-black text-slate-900">{formatMoneyCents(portfolio.totalAcquisitionValue)}</p>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs uppercase tracking-wide text-slate-500">Market Value</p>
        <p className="mt-1 text-2xl font-black text-slate-900">{formatMoneyCents(portfolio.totalMarketValue)}</p>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs uppercase tracking-wide text-slate-500">Unrealized P&L</p>
        <p className={`mt-1 text-2xl font-black ${portfolio.totalPnl >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
          {portfolio.totalPnl >= 0 ? "+" : "-"}
          {formatMoneyCents(Math.abs(portfolio.totalPnl))}
        </p>
      </div>
    </section>
  );
}
