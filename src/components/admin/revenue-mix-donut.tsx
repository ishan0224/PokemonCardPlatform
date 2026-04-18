import type { EconomicsSummary, RevenueStreamBreakdown } from "@/lib/types";
import { formatPlainPercentBps, formatSignedMoneyCents } from "@/lib/format";
import { STREAM_STYLES } from "./styles";

type RevenueMixDonutProps = {
  summary: EconomicsSummary;
};

const RADIUS = 46;
const CIRC = 2 * Math.PI * RADIUS;

function sliceFromShare(share: number): { dasharray: string; dashoffset: number } {
  const length = share * CIRC;
  const gap = CIRC - length;
  return {
    dasharray: `${length} ${gap}`,
    dashoffset: 0
  };
}

export function RevenueMixDonut({ summary }: RevenueMixDonutProps): JSX.Element {
  const totals = summary.revenueByStream.filter((entry) => entry.totalCents !== 0);
  const sumAbs = totals.reduce((acc, entry) => acc + Math.abs(entry.totalCents), 0);

  let cumulativeOffset = 0;
  const slices = totals.map((entry) => {
    const share = sumAbs === 0 ? 0 : Math.abs(entry.totalCents) / sumAbs;
    const length = share * CIRC;
    const slice = { entry, share, length, dashOffset: -cumulativeOffset };
    cumulativeOffset += length;
    return slice;
  });

  const netSign = summary.netRevenueCents < 0 ? "critical" : summary.netRevenueCents > 0 ? "positive" : "neutral";
  const centerText =
    sumAbs === 0
      ? "—"
      : `${formatPlainPercentBps(summary.takeRateBps)}`;
  const centerClass =
    netSign === "critical" ? "text-rose-600" : netSign === "positive" ? "text-emerald-600" : "text-slate-700";

  return (
    <div className="flex h-full flex-col">
      <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">Contribution mix · absolute $</h2>
      <p className="mt-1 text-xs text-slate-500">Share of total cash flow, by stream.</p>

      <div className="relative mx-auto mt-4 flex h-48 w-48 items-center justify-center">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
          <circle cx={60} cy={60} r={RADIUS} fill="none" stroke="#e2e8f0" strokeWidth={14} />
          {slices.map(({ entry, length, dashOffset }) => {
            const swatch = strokeColorFor(entry);
            return (
              <circle
                key={entry.stream}
                cx={60}
                cy={60}
                r={RADIUS}
                fill="none"
                stroke={swatch}
                strokeWidth={14}
                strokeDasharray={`${length} ${CIRC - length}`}
                strokeDashoffset={dashOffset}
                strokeLinecap="butt"
              />
            );
          })}
        </svg>
        <div className="absolute text-center">
          <div className="font-mono text-[9px] uppercase tracking-widest text-slate-500">Take rate</div>
          <div className={`text-3xl font-black tabular-nums ${centerClass}`}>{centerText}</div>
          <div className="text-[10px] text-slate-500">vs GMV</div>
        </div>
      </div>

      <div className="mt-4 space-y-2 text-xs">
        {summary.revenueByStream
          .filter((entry) => entry.totalCents !== 0 || entry.rowCount > 0)
          .map((entry) => {
            const style = STREAM_STYLES[entry.stream];
            const share = sumAbs === 0 ? 0 : Math.abs(entry.totalCents) / sumAbs;
            return (
              <div
                key={entry.stream}
                className={`flex items-center justify-between rounded-lg border ${style.badgeClass} px-3 py-2`}
              >
                <span className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-sm ${style.swatchClass}`} />
                  {style.label}
                </span>
                <span className="tabular-nums">
                  {(share * 100).toFixed(2)}%
                  <span className={`ml-2 font-semibold ${entry.totalCents < 0 ? "text-rose-700" : "text-emerald-700"}`}>
                    {formatSignedMoneyCents(entry.totalCents)}
                  </span>
                </span>
              </div>
            );
          })}
      </div>

      <div className="mt-auto pt-4" />
    </div>
  );
}

function strokeColorFor(entry: RevenueStreamBreakdown): string {
  switch (entry.stream) {
    case "pack_margin":
      return entry.totalCents < 0 ? "#ef4444" : "#f97316";
    case "auction_fee":
      return "#f59e0b";
    case "trade_fee":
      return "#6366f1";
    case "platform_discount":
      return "#94a3b8";
    case "manual_adjustment":
    default:
      return "#64748b";
  }
}
