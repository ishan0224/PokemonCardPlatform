import type { ReactNode } from "react";

type LegalShellProps = {
  title: string;
  updatedOn: string;
  children: ReactNode;
};

export function LegalShell({ title, updatedOn, children }: LegalShellProps): JSX.Element {
  return (
    <article className="rounded-2xl border border-pv-border bg-white p-6 shadow-sm sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-pv-muted">PullVault Policies (Draft)</p>
      <h1 className="mt-2 text-3xl font-black text-pv-ink">{title}</h1>
      <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Placeholder content for development only. Replace with reviewed legal copy before production launch.
      </p>
      <p className="mt-2 text-xs text-pv-muted">Last updated: {updatedOn}</p>
      <div className="prose prose-sm mt-6 max-w-none text-pv-ink">{children}</div>
    </article>
  );
}
