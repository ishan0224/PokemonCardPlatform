import type { AuctionPriceVsMarketMetrics } from "@/lib/types";

type AuctionPriceVsMarketCardProps = {
  metrics: AuctionPriceVsMarketMetrics;
};

const PERCENTILE_ROWS: Array<{ key: "p10" | "p50" | "p90"; label: string }> = [
  { key: "p10", label: "P10" },
  { key: "p50", label: "P50" },
  { key: "p90", label: "P90" }
];

function formatRatioMultiple(value: number): string {
  return `${value.toFixed(2)}x`;
}

function formatRatioPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function toBarWidth(value: number): string {
  const normalized = Math.max(0, Math.min(2, value));
  return `${Math.max(4, normalized * 50)}%`;
}

export function AuctionPriceVsMarketCard({ metrics }: AuctionPriceVsMarketCardProps): JSX.Element {
  return (
    <section className="h-full rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-pv-h3">Final price vs market</h2>
        <span className="text-[11px] text-pv-muted">{metrics.sampleSize.toLocaleString()} closes</span>
      </div>

      {metrics.sampleSize === 0 ? (
        <p className="text-[13px] text-pv-muted">No closed auctions in window.</p>
      ) : (
        <>
          <div className="rounded-pv-sm border border-pv-line bg-pv-surface-3 px-3 py-2">
            <p className="text-[11px] uppercase tracking-[0.08em] text-pv-muted">Median close/market</p>
            <p className="mt-1 text-[24px] font-extrabold tabular-nums text-pv-text">
              {formatRatioMultiple(metrics.medianRatio)}
            </p>
            <p className="text-[11px] text-pv-muted">mean {formatRatioMultiple(metrics.meanRatio)}</p>
          </div>

          <div className="mt-3 space-y-2">
            {PERCENTILE_ROWS.map(({ key, label }) => {
              const value = metrics[key];
              return (
                <div key={key}>
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="text-pv-muted">{label}</span>
                    <span className="font-bold tabular-nums text-pv-text">
                      {formatRatioMultiple(value)} ({formatRatioPercent(value)})
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-pv-surface-3">
                    <div className="h-full rounded-full bg-pv-gold/70" style={{ width: toBarWidth(value) }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
            <div className="rounded-pv-sm border border-pv-line bg-pv-surface-3 px-2 py-1.5">
              <p className="text-pv-muted">Below 40%</p>
              <p className="font-bold tabular-nums text-pv-accent">{metrics.lowRatioCount.toLocaleString()}</p>
            </div>
            <div className="rounded-pv-sm border border-pv-line bg-pv-surface-3 px-2 py-1.5">
              <p className="text-pv-muted">Above 200%</p>
              <p className="font-bold tabular-nums text-pv-good">{metrics.highRatioCount.toLocaleString()}</p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
