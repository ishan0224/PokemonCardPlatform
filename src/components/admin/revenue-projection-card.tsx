import type { RevenueProjection, RevenueProjectionStreamKey } from "@/lib/types";
import { formatSignedMoneyCents } from "@/lib/format";

type RevenueProjectionCardProps = {
  projection: RevenueProjection;
};

const STREAM_LABELS: Record<RevenueProjectionStreamKey, string> = {
  pack_margin: "Pack margin",
  trade_fee: "Trade fee",
  auction_fee: "Auction fee"
};

const STREAM_ORDER: RevenueProjectionStreamKey[] = ["pack_margin", "trade_fee", "auction_fee"];

export function RevenueProjectionCard({ projection }: RevenueProjectionCardProps): JSX.Element {
  const isInsufficientData = STREAM_ORDER.every((stream) => {
    const row = projection.perStream[stream];
    return row.historicalDaily === 0 && row.projectedHorizon === 0;
  });

  return (
    <div className="h-full rounded-pv-lg border border-pv-line bg-pv-surface-2 p-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-pv-h3">Revenue projections</h2>
        <span className="rounded-full bg-pv-surface-3 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted">
          Linear extrapolation
        </span>
      </div>

      <p className="text-[11px] text-pv-muted">
        From last {projection.windowDays}d; projected next {projection.horizonDays}d. Not a forecast.
      </p>

      {isInsufficientData ? (
        <div className="mt-4 rounded-pv-sm border border-dashed border-pv-line bg-pv-surface-3 p-4 text-[12px] text-pv-muted">
          Insufficient data.
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {STREAM_ORDER.map((stream) => {
            const row = projection.perStream[stream];
            return (
              <div
                key={stream}
                className="flex items-center justify-between gap-2 rounded-pv-sm border border-pv-line bg-pv-surface-3 px-3 py-2 text-[12px]"
              >
                <span className="text-pv-muted">{STREAM_LABELS[stream]}</span>
                <span className="tabular-nums text-pv-text">
                  {formatSignedMoneyCents(row.historicalDaily)}/day to{" "}
                  <span className="font-bold">{formatSignedMoneyCents(row.projectedHorizon)}</span>
                </span>
              </div>
            );
          })}
          <div className="mt-2 flex items-center justify-between border-t border-pv-line pt-2 text-[13px]">
            <span className="font-bold text-pv-muted">Total horizon</span>
            <span className="font-extrabold tabular-nums text-pv-text">
              {formatSignedMoneyCents(projection.totalProjectedHorizon)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
