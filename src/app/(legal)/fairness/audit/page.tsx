import Link from "next/link";
import { LegalShell } from "@/components/ui/legal-shell";
import { buttonClassName } from "@/components/ui/button-styles";
import { routes } from "@/lib/routes";
import { RARITY_TIERS, type RarityTier } from "@/lib/types";
import { getLatestPublicFairnessAuditResult } from "@/server/services/fairness-audit.service";

export const revalidate = 300;

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

export default async function FairnessAuditPublicPage(): Promise<JSX.Element> {
  const audit = await getLatestPublicFairnessAuditResult();

  return (
    <LegalShell title="Public Fairness Audit" updatedOn="April 22, 2026">
      {!audit ? (
        <>
          <p>
            A nightly aggregate fairness audit is not available yet. This page will publish observed vs expected rarity
            distribution as soon as the first nightly run is recorded.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Link href={routes.fairness.publicVerifyIndex} className={buttonClassName({ variant: "secondary", size: "sm" })}>
              Open Verifier
            </Link>
            <Link href={routes.legal.fairnessExplainer} className={buttonClassName({ variant: "ghost", size: "sm" })}>
              Fairness Explainer
            </Link>
          </div>
        </>
      ) : (
        <>
          <p>
            Over this nightly window, <strong>{formatCount(audit.sampleSize)}</strong> opened packs were included. The
            aggregate rarity distribution is compared against advertised weights using a chi-squared test.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="rounded-pv-sm border border-pv-line bg-pv-surface-2 p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">p-value</p>
              <p className="text-[18px] font-black text-pv-text">{audit.pValue.toFixed(4)}</p>
            </div>
            <div className="rounded-pv-sm border border-pv-line bg-pv-surface-2 p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">Chi-squared</p>
              <p className="text-[18px] font-black text-pv-text">{audit.chiSquared.toFixed(2)}</p>
            </div>
            <div className="rounded-pv-sm border border-pv-line bg-pv-surface-2 p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">Degrees of freedom</p>
              <p className="text-[18px] font-black text-pv-text">{audit.degreesOfFreedom}</p>
            </div>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
                  <th className="border-b border-pv-line px-2 py-2">Rarity</th>
                  <th className="border-b border-pv-line px-2 py-2 text-right">Observed</th>
                  <th className="border-b border-pv-line px-2 py-2 text-right">Expected</th>
                </tr>
              </thead>
              <tbody>
                {RARITY_TIERS.map((rarity: RarityTier) => (
                  <tr key={rarity} className="border-b border-pv-line last:border-b-0">
                    <td className="px-2 py-2 font-semibold text-pv-text">{rarity}</td>
                    <td className="px-2 py-2 text-right font-mono text-pv-text">
                      {formatCount(audit.observedCounts[rarity])}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-pv-muted">
                      {audit.expectedCounts[rarity].toFixed(0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-[12px] text-pv-muted">
            Window: {new Date(audit.windowStart).toLocaleString()} → {new Date(audit.windowEnd).toLocaleString()} ·
            Source: {audit.runSource} · Last ran: {new Date(audit.ranAt).toLocaleString()}
          </p>
          <p className="mt-1 text-[12px] text-pv-muted">
            {audit.monteCarloApplied
              ? `Sparse-bucket calibration: Monte Carlo with ${formatCount(audit.monteCarloSampleCount ?? 0)} samples.`
              : "Method: chi-squared analytic p-value."}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Link href={routes.fairness.publicVerifyIndex} className={buttonClassName({ variant: "secondary", size: "sm" })}>
              Open Verifier
            </Link>
            <Link href={routes.legal.fairnessExplainer} className={buttonClassName({ variant: "ghost", size: "sm" })}>
              Fairness Explainer
            </Link>
          </div>
        </>
      )}
    </LegalShell>
  );
}
