import type { ReactNode } from "react";

type StatTileTone = "default" | "good" | "bad" | "gold" | "muted";

type StatTileProps = {
  label: ReactNode;
  value: ReactNode;
  delta?: ReactNode;
  tone?: StatTileTone;
  valueClassName?: string;
  className?: string;
};

function cx(...parts: Array<string | undefined | null | false>): string {
  return parts.filter(Boolean).join(" ");
}

const deltaToneClassName: Record<StatTileTone, string> = {
  default: "text-pv-good",
  good: "text-pv-good",
  bad: "text-pv-accent",
  gold: "text-pv-gold",
  muted: "text-pv-muted"
};

export function StatTile({
  label,
  value,
  delta,
  tone = "default",
  valueClassName,
  className
}: StatTileProps): JSX.Element {
  return (
    <div
      className={cx(
        "flex flex-col gap-1 rounded-pv border border-pv-line bg-pv-surface-2 p-[14px_16px]",
        className
      )}
    >
      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted">
        {label}
      </span>
      <span className={cx("font-extrabold leading-tight tracking-[-0.01em]", valueClassName ?? "text-[22px]")}>
        {value}
      </span>
      {delta ? (
        <span className={cx("text-[11px] font-bold", deltaToneClassName[tone])}>{delta}</span>
      ) : null}
    </div>
  );
}
