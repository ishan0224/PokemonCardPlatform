import { formatMoneyCents } from "@/lib/format";

type MoneyChipTone = "default" | "good" | "bad" | "gold" | "muted";

type MoneyChipProps = {
  cents: number;
  tone?: MoneyChipTone;
  prefix?: string;
  className?: string;
};

function cx(...parts: Array<string | undefined | null | false>): string {
  return parts.filter(Boolean).join(" ");
}

const toneClassName: Record<MoneyChipTone, string> = {
  default: "text-pv-text",
  good: "text-pv-good",
  bad: "text-pv-accent",
  gold: "text-pv-gold",
  muted: "text-pv-muted"
};

export function MoneyChip({ cents, tone = "default", prefix, className }: MoneyChipProps): JSX.Element {
  return (
    <span className={cx("font-extrabold tabular-nums", toneClassName[tone], className)}>
      {prefix}
      {formatMoneyCents(cents)}
    </span>
  );
}
