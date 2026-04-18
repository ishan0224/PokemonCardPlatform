import type { ReactNode } from "react";

type KpiVariant = "default" | "critical" | "positive";

type KpiCardProps = {
  label: string;
  value: string;
  variant?: KpiVariant;
  badge?: {
    label: string;
    tone: "neutral" | "critical" | "positive";
  };
  caption?: ReactNode;
  children?: ReactNode;
};

const VARIANT_STYLES: Record<KpiVariant, { shell: string; label: string; value: string }> = {
  default: {
    shell: "border-slate-200 bg-white",
    label: "text-slate-500",
    value: "text-slate-950"
  },
  critical: {
    shell: "border-rose-200 bg-gradient-to-br from-rose-50 to-white",
    label: "text-rose-600",
    value: "text-rose-600"
  },
  positive: {
    shell: "border-emerald-200 bg-gradient-to-br from-emerald-50 to-white",
    label: "text-emerald-700",
    value: "text-emerald-700"
  }
};

const BADGE_TONES: Record<NonNullable<KpiCardProps["badge"]>["tone"], string> = {
  neutral: "bg-slate-100 text-slate-600",
  critical: "bg-rose-100 text-rose-700",
  positive: "bg-emerald-100 text-emerald-700"
};

export function KpiCard({ label, value, variant = "default", badge, caption, children }: KpiCardProps): JSX.Element {
  const styles = VARIANT_STYLES[variant];

  return (
    <div className={`rounded-2xl border ${styles.shell} p-5`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`font-mono text-[10px] uppercase tracking-widest ${styles.label}`}>{label}</span>
        {badge ? (
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${BADGE_TONES[badge.tone]}`}>
            {badge.label}
          </span>
        ) : null}
      </div>
      <div className={`mt-3 text-3xl font-black tracking-tight tabular-nums ${styles.value}`}>{value}</div>
      {caption ? <div className="mt-1 text-xs text-slate-500">{caption}</div> : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}
