import Link from "next/link";
import type { IntegrityChecks } from "@/lib/types";
import { routes } from "@/lib/routes";

type IntegrityListProps = {
  integrity: IntegrityChecks;
};

const STATUS_TONE = {
  pass: "text-pv-good",
  warn: "text-pv-warn",
  fail: "text-pv-accent"
} as const;

export function IntegrityList({ integrity }: IntegrityListProps): JSX.Element {
  return (
    <section className="h-full rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-pv-h3">Integrity</h2>
        <span className="text-[11px] text-pv-muted">window</span>
      </div>

      <ul className="space-y-2 text-[12px]">
        {integrity.checks.map((check) => {
          const tone = STATUS_TONE[check.status];
          return (
            <li key={check.key} className="flex items-center justify-between gap-2">
              <span className="text-pv-muted">{check.label}</span>
              <span className={`font-bold tabular-nums ${tone}`}>{check.detail}</span>
            </li>
          );
        })}
      </ul>

      <Link
        href={routes.admin.auctionFlags}
        className="mt-3 inline-block text-[12px] font-bold text-pv-muted hover:text-pv-text"
      >
        Open flag queue →
      </Link>
    </section>
  );
}
