import type { HourlyRevenueBucket } from "@/lib/types";
import { formatSignedMoneyCents } from "@/lib/format";

type RevenueTimeChartProps = {
  series: HourlyRevenueBucket[];
};

const AXIS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

function bucketNetCents(bucket: HourlyRevenueBucket): number {
  return bucket.netCents;
}

export function RevenueTimeChart({ series }: RevenueTimeChartProps): JSX.Element {
  if (series.length === 0) {
    return (
      <div className="rounded-pv border border-dashed border-pv-line bg-pv-surface-3 py-10 text-center text-sm text-pv-muted">
        No hourly data in window.
      </div>
    );
  }

  const maxNet = Math.max(1, ...series.map((b) => Math.abs(bucketNetCents(b))));
  const nowCutoffIndex = series.findIndex((b) => new Date(b.hourIso).getTime() > Date.now());
  const firstLabel = AXIS_FORMATTER.format(new Date(series[0].hourIso));
  const lastLabel =
    series.length > 1 ? AXIS_FORMATTER.format(new Date(series[series.length - 1].hourIso)) : "";

  const totalPackMargin = series.reduce((acc, b) => acc + b.packMarginCents, 0);
  const totalTradeFee = series.reduce((acc, b) => acc + b.tradeFeeCents, 0);
  const totalAuctionFee = series.reduce((acc, b) => acc + b.auctionFeeCents, 0);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-pv-h3">Revenue · hourly</h2>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-pv-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-pv-gold" />
            Pack margin
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-pv-r-rare" />
            Trade fee
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-pv-r-holo" />
            Auction fee
          </span>
        </div>
      </div>

      <div
        role="img"
        aria-label="Net revenue per hour"
        className="grid items-end gap-[3px] rounded-pv-sm bg-[rgba(23,23,27,0.4)] px-2 py-2"
        style={{
          gridTemplateColumns: `repeat(${series.length}, 1fr)`,
          height: "140px"
        }}
      >
        {series.map((bucket, index) => {
          const heightPct = Math.max(4, (Math.abs(bucketNetCents(bucket)) / maxNet) * 100);
          const isFuture = nowCutoffIndex !== -1 && index >= nowCutoffIndex;
          return (
            <div
              key={bucket.hourIso}
              title={`${AXIS_FORMATTER.format(new Date(bucket.hourIso))} · ${formatSignedMoneyCents(bucket.netCents)}`}
              className={`rounded-t-[3px] ${
                isFuture
                  ? "bg-gradient-to-b from-pv-line-strong to-pv-line opacity-70"
                  : "bg-gradient-to-b from-pv-gold to-[#ff82a9] opacity-85"
              }`}
              style={{ height: `${heightPct}%` }}
            />
          );
        })}
      </div>

      <div className="mt-1 flex items-center justify-between text-[11px] text-pv-muted">
        <span>{firstLabel}</span>
        <span>{lastLabel}</span>
        <span>now</span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 text-[12px]">
        <div className="rounded-pv-sm border border-pv-line bg-pv-surface-3 p-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">Pack margin</p>
          <p
            className={`mt-1 text-[15px] font-extrabold tabular-nums ${
              totalPackMargin < 0 ? "text-pv-accent" : "text-pv-gold"
            }`}
          >
            {formatSignedMoneyCents(totalPackMargin)}
          </p>
        </div>
        <div className="rounded-pv-sm border border-pv-line bg-pv-surface-3 p-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">Trade fee</p>
          <p className="mt-1 text-[15px] font-extrabold tabular-nums text-pv-r-rare">
            {formatSignedMoneyCents(totalTradeFee)}
          </p>
        </div>
        <div className="rounded-pv-sm border border-pv-line bg-pv-surface-3 p-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">Auction fee</p>
          <p className="mt-1 text-[15px] font-extrabold tabular-nums text-pv-r-holo">
            {formatSignedMoneyCents(totalAuctionFee)}
          </p>
        </div>
      </div>
    </div>
  );
}
