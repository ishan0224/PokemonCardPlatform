import Link from "next/link";
import { Button } from "@/components/ui/button";
import { buttonClassName } from "@/components/ui/button-styles";
import { routes } from "@/lib/routes";
import { formatDateTime } from "@/lib/format";
import { useSession } from "@/server/auth/session";
import { getLatestNightlyFairnessAuditResult } from "@/server/services/fairness-audit.service";
import { listAdminFairnessDropSummaries, type FairnessAdminDropSummary } from "@/server/services/fairness-query.service";

function statusMeta(summary: FairnessAdminDropSummary): { icon: string; label: string; className: string } {
  if (summary.packCount === 0) {
    return { icon: "•", label: "No packs", className: "bg-slate-100 text-slate-900" };
  }

  if (summary.decryptFailedCount > 0) {
    return { icon: "✕", label: "Attention", className: "bg-rose-100 text-rose-900" };
  }

  if (summary.unrevealedCount > 0) {
    return { icon: "⏳", label: "Pending reveal", className: "bg-sky-100 text-sky-900" };
  }

  if (summary.legacyCount === summary.packCount) {
    return { icon: "!", label: "Legacy only", className: "bg-amber-100 text-amber-900" };
  }

  return { icon: "✓", label: "Ready", className: "bg-emerald-100 text-emerald-900" };
}

export default async function AdminFairnessPage(): Promise<JSX.Element> {
  const session = await useSession();

  if (!session.isAuthenticated || !session.user) {
    return (
      <section className="rounded-2xl border border-pv-border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-black text-pv-ink">Admin Fairness</h1>
        <p className="mt-2 text-sm text-pv-muted">Sign in with an admin account to review fairness by drop.</p>
        <Link href={routes.auth.login} className={`${buttonClassName({ variant: "primary" })} mt-4`}>
          Go to Login
        </Link>
      </section>
    );
  }

  if (session.user.role !== "admin") {
    return (
      <section className="rounded-2xl border border-pv-border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-black text-pv-ink">Forbidden</h1>
        <p className="mt-2 text-sm text-pv-muted">Your account is not authorized to access admin fairness.</p>
      </section>
    );
  }

  const [summaries, nightlyAudit] = await Promise.all([listAdminFairnessDropSummaries(), getLatestNightlyFairnessAuditResult(7)]);

  return (
    <section className="space-y-5">
      <header className="rounded-2xl border border-pv-border bg-white p-5 shadow-sm">
        <h1 className="text-3xl font-black text-pv-ink">Admin Fairness</h1>
        <p className="mt-1 text-sm text-pv-muted">Drop-by-drop fairness status with direct verifier entrypoints.</p>
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-xl bg-pv-parchment-soft p-3">
            <p className="text-xs uppercase tracking-wide text-pv-muted">Nightly audit</p>
            <p className="font-semibold text-pv-ink">{nightlyAudit ? "Available" : "Not available"}</p>
          </div>
          <div className="rounded-xl bg-pv-parchment-soft p-3">
            <p className="text-xs uppercase tracking-wide text-pv-muted">Audit p-value (7d)</p>
            <p className="font-semibold text-pv-ink">{nightlyAudit ? nightlyAudit.pValue.toFixed(6) : "N/A"}</p>
          </div>
          <div className="rounded-xl bg-pv-parchment-soft p-3">
            <p className="text-xs uppercase tracking-wide text-pv-muted">Drops tracked</p>
            <p className="font-semibold text-pv-ink">{summaries.length}</p>
          </div>
        </div>
      </header>

      <section className="overflow-x-auto rounded-2xl border border-pv-border bg-white shadow-sm">
        <table className="min-w-full border-collapse text-sm" role="table" aria-label="Drop fairness status">
          <thead>
            <tr className="border-b border-pv-border bg-pv-parchment-soft text-left text-xs uppercase tracking-wide text-pv-muted">
              <th className="px-4 py-3">Drop</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Pack totals</th>
              <th className="px-4 py-3">Verifier</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((summary) => {
              const status = statusMeta(summary);

              return (
                <tr key={summary.dropId} className="border-b border-pv-border last:border-0">
                  <td className="px-4 py-3 align-top">
                    <p className="font-semibold text-pv-ink">{summary.dropId.slice(0, 8)}</p>
                    <p className="text-xs text-pv-muted">Scheduled {formatDateTime(summary.dropScheduledAt)}</p>
                    <p className="text-xs text-pv-muted">Lifecycle {summary.dropStatus}</p>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${status.className}`}>
                      <span aria-hidden="true">{status.icon}</span>
                      <span>{status.label}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-pv-muted">
                    <p>Total {summary.packCount}</p>
                    <p>Verifiable {summary.verifiableCount}</p>
                    <p>Unrevealed {summary.unrevealedCount}</p>
                    <p>Legacy {summary.legacyCount}</p>
                    <p>Decrypt failed {summary.decryptFailedCount}</p>
                  </td>
                  <td className="px-4 py-3 align-top">
                    {summary.latestPackId ? (
                      <Link href={routes.fairness.verify(summary.latestPackId)} className={buttonClassName({ variant: "secondary", size: "sm" })}>
                        Open pack verifier
                      </Link>
                    ) : (
                      <Button variant="ghost" size="sm" disabled>
                        No packs yet
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </section>
  );
}
