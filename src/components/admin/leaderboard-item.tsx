import type { ReactNode } from "react";

type LeaderboardItemProps = {
  rank?: number;
  avatar:
    | {
        kind?: "text";
        label: string;
        className: string;
      }
    | {
        kind: "image";
        imageUrl: string;
        alt: string;
        fallbackLabel: string;
        fallbackClassName: string;
      };
  title: string;
  subtitle: ReactNode;
  primaryValue: string;
  primaryClassName?: string;
  secondaryValue?: ReactNode;
};

export function LeaderboardItem({
  rank,
  avatar,
  title,
  subtitle,
  primaryValue,
  primaryClassName,
  secondaryValue
}: LeaderboardItemProps): JSX.Element {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      {typeof rank === "number" ? (
        <span className="font-mono text-[11px] text-slate-500 w-5">{rank.toString().padStart(2, "0")}</span>
      ) : null}
      {avatar.kind === "image" ? (
        <div className="h-10 w-10 overflow-hidden rounded-lg bg-slate-100">
          {avatar.imageUrl ? (
            <img src={avatar.imageUrl} alt={avatar.alt} className="h-full w-full object-cover" />
          ) : (
            <div
              className={`flex h-full w-full items-center justify-center text-sm font-bold ${avatar.fallbackClassName}`}
            >
              {avatar.fallbackLabel}
            </div>
          )}
        </div>
      ) : (
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold ${avatar.className}`}
        >
          {avatar.label}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="truncate font-mono text-sm font-semibold">{title}</div>
        <div className="truncate text-[11px] text-slate-500">{subtitle}</div>
      </div>
      <div className="text-right">
        <div className={`text-sm font-bold tabular-nums ${primaryClassName ?? "text-slate-900"}`}>{primaryValue}</div>
        {secondaryValue ? <div className="text-[11px] text-slate-500">{secondaryValue}</div> : null}
      </div>
    </div>
  );
}
