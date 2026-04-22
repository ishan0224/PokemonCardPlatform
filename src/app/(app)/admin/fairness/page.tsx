import Link from "next/link";
import { Button } from "@/components/ui/button";
import { buttonClassName } from "@/components/ui/button-styles";
import { Chip } from "@/components/ui/chip";
import { RarityBadge } from "@/components/ui/rarity-badge";
import { routes } from "@/lib/routes";
import { formatDateTime } from "@/lib/format";
import { useSession } from "@/server/auth/session";
import { getLatestNightlyFairnessAuditResult } from "@/server/services/fairness-audit.service";
import {
  listAdminFairnessDropSummaries,
  type FairnessAdminDropSummary
} from "@/server/services/fairness-query.service";
import { RARITY_TIERS } from "@/lib/types";
import type { FairnessAuditResult, RarityTier } from "@/lib/types";

type StatusInfo = {
  tone: "good" | "info" | "upcoming" | "danger" | "neutral";
  label: string;
  icon: string;
};

function statusInfo(summary: FairnessAdminDropSummary): StatusInfo {
  if (summary.packCount === 0) return { tone: "neutral", label: "No packs", icon: "•" };
  if (summary.decryptFailedCount > 0) return { tone: "danger", label: "Attention", icon: "✕" };
  if (summary.unrevealedCount > 0) return { tone: "info", label: "Pending reveal", icon: "⏳" };
  if (summary.legacyCount === summary.packCount)
    return { tone: "upcoming", label: "Legacy only", icon: "!" };
  return { tone: "good", label: "Ready", icon: "✓" };
}

function formatRelative(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  const deltaMs = Date.now() - parsed.getTime();
  if (deltaMs < 60_000) return "just now";
  if (deltaMs < 3_600_000) return `${Math.floor(deltaMs / 60_000)}m ago`;
  if (deltaMs < 86_400_000) return `${Math.floor(deltaMs / 3_600_000)}h ago`;
  const days = Math.floor(deltaMs / 86_400_000);
  return `${days}d ${Math.floor((deltaMs % 86_400_000) / 3_600_000)}h ago`;
}

function pctDelta(observed: number, expected: number): string {
  if (expected <= 0) return "—";
  const delta = ((observed - expected) / expected) * 100;
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`;
}

function deltaTone(observed: number, expected: number): string {
  if (expected <= 0) return "text-pv-muted";
  const delta = (observed - expected) / expected;
  return delta >= 0 ? "text-pv-good" : "text-pv-muted";
}

function gaugeMarkerPercent(pValue: number): number {
  // Simple mapping: compress low end, spread high end.
  const clamped = Math.max(0, Math.min(1, pValue));
  if (clamped < 0.01) return Math.max(0, clamped * 1000); // 0..10%
  if (clamped < 0.05) return 10 + ((clamped - 0.01) / 0.04) * 10; // 10..20%
  if (clamped < 0.25) return 20 + ((clamped - 0.05) / 0.2) * 25; // 20..45%
  return 45 + ((clamped - 0.25) / 0.75) * 55; // 45..100%
}

function packTotalsRow(summary: FairnessAdminDropSummary): JSX.Element {
  const total = summary.packCount;
  const opened = Math.max(0, total - summary.unrevealedCount);
  const openedPct = total > 0 ? (opened / total) * 100 : 0;
  const pendingPct = total > 0 ? (summary.unrevealedCount / total) * 100 : 0;
  const legacyPct = total > 0 ? (summary.legacyCount / total) * 100 : 0;
  const failPct = total > 0 ? (summary.decryptFailedCount / total) * 100 : 0;
  return (
    <div className="min-w-[260px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
        <span className="text-pv-muted">Total</span>
        <strong className="text-pv-text">{total}</strong>
        <span className="text-pv-muted">Verifiable</span>
        <strong className="text-pv-good">{summary.verifiableCount}</strong>
        <span className="text-pv-muted">Unrevealed</span>
        <strong className="text-pv-info">{summary.unrevealedCount}</strong>
        {summary.legacyCount > 0 ? (
          <>
            <span className="text-pv-muted">Legacy</span>
            <strong className="text-pv-warn">{summary.legacyCount}</strong>
          </>
        ) : null}
        {summary.decryptFailedCount > 0 ? (
          <>
            <span className="text-pv-muted">Decrypt fail</span>
            <strong className="text-pv-accent">{summary.decryptFailedCount}</strong>
          </>
        ) : null}
      </div>
      {total > 0 ? (
        <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-pv-surface-4">
          <div className="h-full bg-pv-good" style={{ width: `${openedPct}%` }} />
          <div className="h-full bg-pv-info" style={{ width: `${pendingPct}%` }} />
          <div className="h-full bg-pv-warn" style={{ width: `${legacyPct}%` }} />
          <div className="h-full bg-pv-accent" style={{ width: `${failPct}%` }} />
        </div>
      ) : (
        <div className="mt-2 h-1.5 w-full rounded-full bg-pv-surface-4" />
      )}
    </div>
  );
}

function NightlyAuditCard({ audit }: { audit: FairnessAuditResult | null }): JSX.Element {
  if (!audit) {
    return (
      <div className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-pv-h3">Nightly chi-square audit · 7-day window</div>
            <p className="mt-1 text-[12px] text-pv-muted">No audit has been recorded yet.</p>
          </div>
          <Chip tone="neutral">Pending</Chip>
        </div>
      </div>
    );
  }

  const passing = audit.pValue >= 0.01;
  const markerPct = gaugeMarkerPercent(audit.pValue);

  return (
    <div className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-pv-h3">Nightly chi-square audit · 7-day window</div>
          <p className="mt-1 text-[12px] text-pv-muted">
            Observed rarity counts vs. expected from pinned generation versions, weighted by
            packs-per-version.
          </p>
        </div>
        <Chip tone={passing ? "good" : "danger"}>{passing ? "Pass" : "Fail"}</Chip>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-pv border border-pv-line bg-pv-surface-3 p-[10px_14px]">
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
            p-value
          </div>
          <div
            className={`text-[20px] font-extrabold tabular-nums ${
              passing ? "text-pv-text" : "text-pv-accent"
            }`}
          >
            {audit.pValue.toFixed(4)}
          </div>
          <div className="text-[11px] text-pv-muted">target ≥ 0.01</div>
        </div>
        <div className="rounded-pv border border-pv-line bg-pv-surface-3 p-[10px_14px]">
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
            Chi-square
          </div>
          <div className="text-[20px] font-extrabold tabular-nums text-pv-text">
            {audit.testStatistic.toFixed(2)}
          </div>
          <div className="text-[11px] text-pv-muted">df = {audit.degreesOfFreedom}</div>
        </div>
        <div className="rounded-pv border border-pv-line bg-pv-surface-3 p-[10px_14px]">
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
            Samples
          </div>
          <div className="text-[20px] font-extrabold tabular-nums text-pv-text">
            {audit.sampleSize.toLocaleString()}
          </div>
          <div className="text-[11px] text-pv-muted">cards · 7d</div>
        </div>
        <div className="rounded-pv border border-pv-line bg-pv-surface-3 p-[10px_14px]">
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
            Last ran
          </div>
          <div className="text-[13px] font-bold text-pv-text">{formatDateTime(audit.ranAtIso)}</div>
          <div className="text-[11px] text-pv-muted">{formatRelative(audit.ranAtIso)}</div>
        </div>
      </div>

      <div className="my-4 h-px bg-pv-line" />

      <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
        p-value on the audit gauge
      </div>
      <div
        role="img"
        aria-label={`p-value ${audit.pValue.toFixed(4)}`}
        className="relative mt-2 h-2.5 rounded-full border border-pv-line"
        style={{
          background:
            "linear-gradient(90deg, rgba(239,68,68,0.55) 0%, rgba(245,158,11,0.55) 20%, rgba(16,185,129,0.5) 45%, rgba(56,189,248,0.45) 75%, rgba(167,139,250,0.45) 100%)"
        }}
      >
        <div
          aria-hidden="true"
          className="absolute -top-1 h-[18px] w-[2px] bg-pv-text shadow-[0_0_0_3px_rgba(255,255,255,0.1)]"
          style={{ left: `${markerPct}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-pv-muted">
        <span>0 · fail</span>
        <span>0.01</span>
        <span>0.05</span>
        <span>0.25</span>
        <span>1 · ideal</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-pv-muted">
        {audit.monteCarloApplied && audit.monteCarloSamples !== null ? (
          <>
            <span>Monte-Carlo null samples · {audit.monteCarloSamples.toLocaleString()}</span>
            <span>
              Extreme tail count · {(audit.monteCarloExtremeCount ?? 0).toLocaleString()}
            </span>
            <span>Method · chi-square + parametric bootstrap</span>
          </>
        ) : (
          <span>Method · chi-square (analytic p-value)</span>
        )}
      </div>
    </div>
  );
}

function ObservedExpectedCard({ audit }: { audit: FairnessAuditResult | null }): JSX.Element {
  return (
    <div className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-pv-h3">Observed vs expected · 7d</div>
        <span className="text-[11px] text-pv-muted">per rarity</span>
      </div>

      {audit ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
                <th className="border-b border-pv-line px-2 py-2">Rarity</th>
                <th className="border-b border-pv-line px-2 py-2 text-right">Observed</th>
                <th className="border-b border-pv-line px-2 py-2 text-right">Expected</th>
                <th className="border-b border-pv-line px-2 py-2 text-right">Δ</th>
              </tr>
            </thead>
            <tbody>
              {RARITY_TIERS.map((rarity: RarityTier) => {
                const observed = audit.observedCounts[rarity];
                const expected = audit.expectedCounts[rarity];
                return (
                  <tr key={rarity} className="border-b border-pv-line last:border-b-0">
                    <td className="px-2 py-2">
                      <RarityBadge rarity={rarity} compact />
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-pv-text">
                      {observed.toLocaleString()}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-pv-muted">
                      {expected.toFixed(0)}
                    </td>
                    <td className={`px-2 py-2 text-right font-semibold ${deltaTone(observed, expected)}`}>
                      {pctDelta(observed, expected)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] text-pv-muted">
            Deviations within the parametric-bootstrap confidence band do not trigger an alert.
          </p>
        </div>
      ) : (
        <p className="text-[13px] text-pv-muted">No audit data available.</p>
      )}
    </div>
  );
}

export default async function AdminFairnessPage(): Promise<JSX.Element> {
  const session = await useSession();

  if (!session.isAuthenticated || !session.user) {
    return (
      <section className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-6">
        <h1 className="text-pv-h1">Admin · Fairness</h1>
        <p className="mt-2 text-[13px] text-pv-muted">
          Sign in with an admin account to review fairness by drop.
        </p>
        <Link
          href={routes.auth.login}
          className={`${buttonClassName({ variant: "primary", size: "sm" })} mt-4`}
        >
          Go to login
        </Link>
      </section>
    );
  }

  if (session.user.role !== "admin") {
    return (
      <section className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-6">
        <h1 className="text-pv-h1">Forbidden</h1>
        <p className="mt-2 text-[13px] text-pv-muted">
          Your account is not authorised to access admin fairness.
        </p>
      </section>
    );
  }

  const [summaries, nightlyAudit] = await Promise.all([
    listAdminFairnessDropSummaries(),
    getLatestNightlyFairnessAuditResult(7)
  ]);

  return (
    <section className="space-y-5">
      {/* HEADER */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-pv-h1">Fairness</h1>
          <p className="mt-1 text-[13px] text-pv-muted">
            Drop-by-drop verifiability status · nightly chi-square audit over a 7-day window.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-pv-line bg-pv-surface-2 px-2.5 py-1 font-mono text-[11px] text-pv-muted">
            pack-gen-v2-deterministic
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-pv-surface-3 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.04em] text-pv-muted">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full bg-pv-good motion-safe:animate-pv-pulse"
            />
            Auditor healthy
          </span>
          <Link
            href={routes.fairness.verifyIndex}
            className={buttonClassName({ variant: "ghost", size: "sm" })}
          >
            Open verifier →
          </Link>
        </div>
      </header>

      {/* NIGHTLY AUDIT + OBSERVED/EXPECTED */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <NightlyAuditCard audit={nightlyAudit} />
        <ObservedExpectedCard audit={nightlyAudit} />
      </section>

      {/* DROPS INDEX */}
      <section className="space-y-3">
        <h2 className="text-pv-h2">Drops</h2>
        <div className="overflow-hidden rounded-pv-lg border border-pv-line bg-pv-surface-2">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
                  <th className="border-b border-pv-line px-4 py-3">Drop</th>
                  <th className="border-b border-pv-line px-4 py-3">Status</th>
                  <th className="border-b border-pv-line px-4 py-3">Pack totals</th>
                  <th className="border-b border-pv-line px-4 py-3 text-right">Verifier</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((summary) => {
                  const status = statusInfo(summary);
                  return (
                    <tr key={summary.dropId} className="border-b border-pv-line last:border-b-0">
                      <td className="px-4 py-3 align-top">
                        <p className="font-bold text-pv-text">Drop {summary.dropId.slice(0, 8)}</p>
                        <p className="font-mono text-[11px] text-pv-muted-2">{summary.dropId}</p>
                        <p className="mt-0.5 text-[11px] text-pv-muted">
                          Scheduled {formatDateTime(summary.dropScheduledAt)} · lifecycle{" "}
                          {summary.dropStatus}
                        </p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <Chip tone={status.tone}>
                          <span aria-hidden="true" className="mr-1">
                            {status.icon}
                          </span>
                          {status.label}
                        </Chip>
                      </td>
                      <td className="px-4 py-3 align-top">{packTotalsRow(summary)}</td>
                      <td className="px-4 py-3 align-top text-right">
                        {summary.latestPackId ? (
                          <Link
                            href={routes.fairness.verify(summary.latestPackId)}
                            className={buttonClassName({ variant: "secondary", size: "sm" })}
                          >
                            Verifier
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
          </div>
        </div>
      </section>
    </section>
  );
}
