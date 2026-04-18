import type { HourlyRevenueBucket } from "@/lib/types";
import { formatCompactCents, formatSignedMoneyCents } from "@/lib/format";
import { STREAM_STYLES } from "./styles";

type RevenueTimeChartProps = {
  series: HourlyRevenueBucket[];
};

const CHART_WIDTH = 800;
const CHART_HEIGHT = 260;
const ZERO_LINE_Y = 70;
const BAR_MAX_BELOW = CHART_HEIGHT - ZERO_LINE_Y;
const BAR_MAX_ABOVE = ZERO_LINE_Y;

function buildAxisFormatter(): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

export function RevenueTimeChart({ series }: RevenueTimeChartProps): JSX.Element {
  if (series.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
        No hourly data in window.
      </div>
    );
  }

  const maxPositive = Math.max(0, ...series.map((bucket) => Math.max(0, bucket.netCents)));
  const maxNegative = Math.max(0, ...series.map((bucket) => Math.max(0, -bucket.netCents)));

  const columnWidth = CHART_WIDTH / Math.max(series.length, 1);
  const barWidth = Math.min(28, columnWidth * 0.55);
  const axisFormatter = buildAxisFormatter();

  const scaleNegative = (value: number): number => (maxNegative === 0 ? 0 : (value / maxNegative) * BAR_MAX_BELOW);
  const scalePositive = (value: number): number => (maxPositive === 0 ? 0 : (value / maxPositive) * BAR_MAX_ABOVE);

  const worstBucket = series.reduce(
    (acc, bucket) => (bucket.netCents < acc.netCents ? bucket : acc),
    series[0]
  );
  const worstIndex = series.indexOf(worstBucket);
  const worstX = worstIndex * columnWidth + columnWidth / 2;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">Net revenue · hourly</h2>
          <p className="mt-1 text-xs text-slate-500">
            Bars below the zero line are negative pack margin. Bars above are fees captured.
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] font-mono text-slate-500">
          <span className="inline-flex items-center gap-1">
            <span className={`inline-block h-2 w-2 rounded-sm ${STREAM_STYLES.pack_margin.swatchClass}`} />
            Pack margin
          </span>
          <span className="inline-flex items-center gap-1">
            <span className={`inline-block h-2 w-2 rounded-sm ${STREAM_STYLES.auction_fee.swatchClass}`} />
            Auction fee
          </span>
          <span className="inline-flex items-center gap-1">
            <span className={`inline-block h-2 w-2 rounded-sm ${STREAM_STYLES.trade_fee.swatchClass}`} />
            Trade fee
          </span>
        </div>
      </div>

      <div className="relative mt-6 h-72 w-full rounded-lg border border-slate-100 bg-slate-50/40">
        <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <line x1={0} y1={ZERO_LINE_Y} x2={CHART_WIDTH} y2={ZERO_LINE_Y} stroke="#475569" strokeWidth={1} />
          <text x={4} y={ZERO_LINE_Y - 4} fontSize={9} fill="#64748b" fontFamily="JetBrains Mono">
            $0
          </text>

          {series.map((bucket, index) => {
            const x = index * columnWidth + (columnWidth - barWidth) / 2;
            const packHeight = bucket.packMarginCents < 0 ? scaleNegative(Math.abs(bucket.packMarginCents)) : 0;
            const packPosTop = ZERO_LINE_Y + Math.max(0, -scalePositive(Math.max(0, bucket.packMarginCents)));
            const auctionTop = ZERO_LINE_Y - scalePositive(Math.max(0, bucket.auctionFeeCents));
            const tradeTop = auctionTop - scalePositive(Math.max(0, bucket.tradeFeeCents));

            return (
              <g key={bucket.hourIso}>
                {bucket.packMarginCents < 0 ? (
                  <rect
                    x={x}
                    y={ZERO_LINE_Y}
                    width={barWidth}
                    height={packHeight}
                    fill="#ef4444"
                    opacity={0.9}
                  />
                ) : null}
                {bucket.packMarginCents > 0 ? (
                  <rect
                    x={x}
                    y={packPosTop}
                    width={barWidth}
                    height={ZERO_LINE_Y - packPosTop}
                    fill="#f97316"
                    opacity={0.9}
                  />
                ) : null}
                {bucket.auctionFeeCents > 0 ? (
                  <rect
                    x={x}
                    y={auctionTop}
                    width={barWidth}
                    height={ZERO_LINE_Y - auctionTop}
                    fill="#f59e0b"
                    opacity={0.95}
                  />
                ) : null}
                {bucket.tradeFeeCents > 0 ? (
                  <rect
                    x={x}
                    y={tradeTop}
                    width={barWidth}
                    height={auctionTop - tradeTop}
                    fill="#6366f1"
                    opacity={0.95}
                  />
                ) : null}
              </g>
            );
          })}

          {worstBucket.netCents < 0 ? (
            <g>
              <line
                x1={worstX}
                y1={0}
                x2={worstX}
                y2={CHART_HEIGHT - 10}
                stroke="#1e293b"
                strokeOpacity={0.2}
                strokeWidth={1}
              />
              <text
                x={worstX}
                y={CHART_HEIGHT - 2}
                fontSize={9}
                fill="#b91c1c"
                fontFamily="JetBrains Mono"
                textAnchor="middle"
              >
                {axisFormatter.format(new Date(worstBucket.hourIso))} · {formatSignedMoneyCents(worstBucket.netCents)}
              </text>
            </g>
          ) : null}
        </svg>

        <div className="pointer-events-none absolute bottom-6 left-6 flex w-[calc(100%-3rem)] justify-between font-mono text-[9px] uppercase tracking-wider text-slate-500">
          <span>{axisFormatter.format(new Date(series[0].hourIso))}</span>
          <span>
            {series.length > 1
              ? axisFormatter.format(new Date(series[series.length - 1].hourIso))
              : ""}
          </span>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryChip
          label="Pack margin"
          value={formatSignedMoneyCents(
            series.reduce((acc, bucket) => acc + bucket.packMarginCents, 0)
          )}
          tone="critical"
          detail={`range ${formatCompactCents(Math.min(0, ...series.map((b) => b.packMarginCents)))} → ${formatCompactCents(Math.max(0, ...series.map((b) => b.packMarginCents)))}`}
        />
        <SummaryChip
          label="Auction fees"
          value={formatSignedMoneyCents(
            series.reduce((acc, bucket) => acc + bucket.auctionFeeCents, 0)
          )}
          tone="amber"
        />
        <SummaryChip
          label="Trade fees"
          value={formatSignedMoneyCents(
            series.reduce((acc, bucket) => acc + bucket.tradeFeeCents, 0)
          )}
          tone="indigo"
        />
      </div>
    </div>
  );
}

type SummaryChipProps = {
  label: string;
  value: string;
  tone: "critical" | "amber" | "indigo";
  detail?: string;
};

function SummaryChip({ label, value, tone, detail }: SummaryChipProps): JSX.Element {
  const toneClass = {
    critical: "border-rose-200 bg-rose-50 text-rose-700",
    amber: "border-slate-200 bg-slate-50 text-amber-600",
    indigo: "border-slate-200 bg-slate-50 text-indigo-600"
  }[tone];

  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <div className="font-mono text-[10px] uppercase tracking-wider">{label}</div>
      <div className="mt-1 text-lg font-bold tabular-nums">{value}</div>
      {detail ? <div className="text-[11px] text-slate-500">{detail}</div> : null}
    </div>
  );
}
