import type { EconomicsSummary, RevenueStreamKey } from "@/lib/types";
import { formatMoneyCents, formatSignedMoneyCents } from "@/lib/format";

type RevenueMixDonutProps = {
  summary: EconomicsSummary;
};

type StreamStyle = {
  label: string;
  color: string;
};

const STREAM_COLOR: Record<RevenueStreamKey, StreamStyle> = {
  pack_margin: { label: "Pack margin", color: "var(--pv-gold)" },
  trade_fee: { label: "Trade fee", color: "var(--pv-r-rare)" },
  auction_fee: { label: "Auction fee", color: "var(--pv-r-holo)" },
  platform_discount: { label: "Platform discount", color: "var(--pv-good)" },
  manual_adjustment: { label: "Manual adj.", color: "var(--pv-line-strong)" }
};

const STREAM_ORDER: RevenueStreamKey[] = [
  "pack_margin",
  "trade_fee",
  "auction_fee",
  "platform_discount",
  "manual_adjustment"
];

export function RevenueMixDonut({ summary }: RevenueMixDonutProps): JSX.Element {
  const ordered = STREAM_ORDER.map((stream) => {
    const entry = summary.revenueByStream.find((e) => e.stream === stream);
    return { stream, totalCents: entry?.totalCents ?? 0 };
  });

  const sumAbs = ordered.reduce((acc, entry) => acc + Math.abs(entry.totalCents), 0);

  // Build conic-gradient stops to mirror the demo donut
  let cumulative = 0;
  const gradientStops: string[] = [];
  for (const entry of ordered) {
    if (sumAbs === 0) break;
    const share = Math.abs(entry.totalCents) / sumAbs;
    const start = (cumulative * 100).toFixed(2);
    cumulative += share;
    const end = (cumulative * 100).toFixed(2);
    gradientStops.push(`${STREAM_COLOR[entry.stream].color} ${start}% ${end}%`);
  }
  const gradient =
    gradientStops.length > 0
      ? `conic-gradient(${gradientStops.join(", ")})`
      : "conic-gradient(var(--pv-line) 0 100%)";

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-pv-h3">Revenue mix</h2>
        <span className="text-[11px] text-pv-muted">by stream</span>
      </div>

      <div className="relative mx-auto grid h-[180px] w-[180px] place-items-center">
        <div
          aria-hidden="true"
          className="absolute inset-0 rounded-full"
          style={{ background: gradient }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-[22px] rounded-full border border-pv-line bg-pv-surface-2"
        />
        <div className="relative z-10 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-pv-muted-2">Net</p>
          <p
            className={`text-[18px] font-extrabold tabular-nums ${
              summary.netRevenueCents < 0 ? "text-pv-accent" : "text-pv-text"
            }`}
          >
            {formatMoneyCents(summary.netRevenueCents)}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-1.5">
        {ordered
          .filter((entry) => entry.totalCents !== 0)
          .map((entry) => {
            const share = sumAbs === 0 ? 0 : Math.abs(entry.totalCents) / sumAbs;
            const style = STREAM_COLOR[entry.stream];
            return (
              <div
                key={entry.stream}
                className="flex items-center justify-between gap-2 text-[12px]"
              >
                <span className="flex items-center gap-2 text-pv-muted">
                  <span
                    aria-hidden="true"
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ background: style.color }}
                  />
                  {style.label}
                </span>
                <span className="tabular-nums text-pv-text">
                  {formatSignedMoneyCents(entry.totalCents)}{" "}
                  <span className="text-pv-muted-2">· {Math.round(share * 100)}%</span>
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
}
