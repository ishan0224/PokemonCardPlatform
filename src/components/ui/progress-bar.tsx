type ProgressTone = "default" | "gold" | "good" | "danger";

type ProgressBarProps = {
  value: number;
  max?: number;
  tone?: ProgressTone;
  className?: string;
  srLabel?: string;
};

function cx(...parts: Array<string | undefined | null | false>): string {
  return parts.filter(Boolean).join(" ");
}

const fillToneClassName: Record<ProgressTone, string> = {
  default: "bg-gradient-to-r from-pv-gold to-pv-r-ultra",
  gold: "bg-pv-gold",
  good: "bg-pv-good",
  danger: "bg-pv-accent"
};

export function ProgressBar({
  value,
  max = 100,
  tone = "default",
  className,
  srLabel
}: ProgressBarProps): JSX.Element {
  const ratio = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  return (
    <div
      className={cx("h-1.5 w-full overflow-hidden rounded-full bg-pv-surface-3", className)}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemax={max}
      aria-valuemin={0}
      aria-label={srLabel}
    >
      <div className={cx("h-full", fillToneClassName[tone])} style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}
