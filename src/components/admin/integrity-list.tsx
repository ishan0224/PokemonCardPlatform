import type { IntegrityChecks } from "@/lib/types";

type IntegrityListProps = {
  integrity: IntegrityChecks;
};

const STATUS_STYLES = {
  pass: {
    card: "border-emerald-200 bg-emerald-50",
    label: "text-emerald-700",
    body: "text-slate-800",
    icon: "text-emerald-600",
    glyph: "✓"
  },
  warn: {
    card: "border-amber-200 bg-amber-50",
    label: "text-amber-700",
    body: "text-slate-800",
    icon: "text-amber-600",
    glyph: "!"
  },
  fail: {
    card: "border-rose-200 bg-rose-50",
    label: "text-rose-700",
    body: "text-rose-900",
    icon: "text-rose-600",
    glyph: "⨯"
  }
} as const;

export function IntegrityList({ integrity }: IntegrityListProps): JSX.Element {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">Integrity</h2>
      <p className="mt-1 text-xs text-slate-500">Ledger checks run live against committed rows.</p>

      <ul className="mt-4 space-y-2 text-sm">
        {integrity.checks.map((check) => {
          const style = STATUS_STYLES[check.status];
          return (
            <li
              key={check.key}
              className={`flex items-center justify-between rounded-lg border px-3 py-2 ${style.card}`}
            >
              <div>
                <div className={`font-mono text-[10px] uppercase tracking-wider ${style.label}`}>{check.label}</div>
                <div className={style.body}>{check.detail}</div>
              </div>
              <span className={`text-lg tabular-nums ${style.icon}`}>{style.glyph}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
