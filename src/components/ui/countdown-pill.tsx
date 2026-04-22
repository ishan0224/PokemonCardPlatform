"use client";

import { useCountdown } from "@/hooks/use-countdown";

type CountdownPillProps = {
  targetIso: string;
  /** Hide the `days` segment when zero. Default: true. */
  compact?: boolean;
  className?: string;
};

function cx(...parts: Array<string | undefined | null | false>): string {
  return parts.filter(Boolean).join(" ");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

type Segment = { value: string; label: string };

export function CountdownPill({ targetIso, compact = true, className }: CountdownPillProps): JSX.Element {
  const c = useCountdown(targetIso);
  const segments: Segment[] = [];
  if (!compact || c.days > 0) {
    segments.push({ value: pad(c.days), label: "d" });
  }
  segments.push({ value: pad(c.hours), label: "h" });
  segments.push({ value: pad(c.minutes), label: "m" });
  segments.push({ value: pad(c.seconds), label: "s" });

  return (
    <div className={cx("inline-flex gap-1.5 tabular-nums font-extrabold", className)} aria-live="off">
      {segments.map((seg) => (
        <div
          key={seg.label}
          className="min-w-[44px] rounded-pv-sm border border-pv-line bg-pv-surface-3 px-2.5 py-1.5 text-center text-base leading-none"
        >
          {seg.value}
          <span className="mt-0.5 block text-[9px] font-bold uppercase tracking-[0.1em] text-pv-muted">
            {seg.label}
          </span>
        </div>
      ))}
    </div>
  );
}
