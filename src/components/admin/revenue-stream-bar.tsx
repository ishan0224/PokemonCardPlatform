import type { RevenueStreamBreakdown } from "@/lib/types";
import { STREAM_STYLES } from "./styles";

type RevenueStreamBarProps = {
  breakdown: RevenueStreamBreakdown[];
};

export function RevenueStreamBar({ breakdown }: RevenueStreamBarProps): JSX.Element {
  const totals = breakdown
    .map((entry) => ({ ...entry, absCents: Math.abs(entry.totalCents) }))
    .filter((entry) => entry.absCents > 0);
  const sumAbs = totals.reduce((acc, entry) => acc + entry.absCents, 0);

  if (sumAbs === 0) {
    return (
      <div className="flex h-6 items-center overflow-hidden rounded-md bg-slate-100 ring-1 ring-inset ring-slate-200 text-[10px] text-slate-500 pl-2">
        No revenue in window
      </div>
    );
  }

  return (
    <div className="flex h-6 overflow-hidden rounded-md bg-slate-100 ring-1 ring-inset ring-slate-200">
      {totals.map((entry) => {
        const width = (entry.absCents / sumAbs) * 100;
        const style = STREAM_STYLES[entry.stream];
        return (
          <div
            key={entry.stream}
            className={style.swatchClass}
            style={{ width: `${width}%` }}
            title={`${style.label} · ${width.toFixed(1)}%`}
          />
        );
      })}
    </div>
  );
}
