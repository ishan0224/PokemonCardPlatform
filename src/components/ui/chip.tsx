import type { ReactNode } from "react";

export type ChipTone =
  | "neutral"
  | "live"
  | "upcoming"
  | "completed"
  | "sold-out"
  | "gold"
  | "good"
  | "info"
  | "danger";

type ChipProps = {
  tone?: ChipTone;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
  /** Renders a pulsing dot on tone="live". Disabled under prefers-reduced-motion. */
  pulse?: boolean;
};

function cx(...parts: Array<string | undefined | null | false>): string {
  return parts.filter(Boolean).join(" ");
}

const toneClassName: Record<ChipTone, string> = {
  neutral: "bg-pv-surface-2 text-pv-muted border-pv-line",
  live: "bg-[rgba(239,68,68,0.12)] text-[#fca5a5] border-pv-accent/30",
  upcoming: "bg-[rgba(245,158,11,0.1)] text-pv-warn border-pv-warn/28",
  completed: "bg-pv-surface-2 text-pv-muted border-pv-line",
  "sold-out": "bg-black text-pv-muted border-pv-line",
  gold: "bg-pv-gold-soft text-pv-gold border-pv-gold/30",
  good: "bg-pv-good-soft text-pv-good border-pv-good/30",
  info: "bg-[rgba(56,189,248,0.1)] text-pv-info border-pv-info/30",
  danger: "bg-[rgba(239,68,68,0.1)] text-[#fca5a5] border-pv-accent/30"
};

export function Chip({ tone = "neutral", children, icon, pulse = false, className }: ChipProps): JSX.Element {
  const showPulse = pulse && tone === "live";
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.04em]",
        toneClassName[tone],
        className
      )}
    >
      {showPulse ? (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-pv-accent shadow-[0_0_0_3px_rgba(239,68,68,0.2)] motion-safe:animate-pv-pulse"
        />
      ) : icon ? (
        <span aria-hidden="true">{icon}</span>
      ) : null}
      {children}
    </span>
  );
}
