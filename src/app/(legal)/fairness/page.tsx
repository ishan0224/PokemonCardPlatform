import Link from "next/link";
import { LegalShell } from "@/components/ui/legal-shell";
import { buttonClassName } from "@/components/ui/button-styles";
import { routes } from "@/lib/routes";

export const revalidate = 3600;

export default function FairnessExplainerPage(): JSX.Element {
  return (
    <LegalShell title="Fairness Explainer" updatedOn="April 22, 2026">
      <p>
        PullVault uses deterministic randomness so every opened pack can be audited after reveal. The verifier checks
        cryptographic inputs and reproduces the same draw sequence slot-by-slot.
      </p>
      <p>
        A pack remains sealed until purchased and opened by the owner. Once revealed, the proof inputs can be used to verify
        that card allocation followed the committed generation version and configured slot distribution.
      </p>
      <p>
        This explainer is development placeholder copy and not a formal security whitepaper. Replace it with validated public
        documentation before production.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Link href={routes.fairness.publicVerifyIndex} className={buttonClassName({ variant: "secondary", size: "sm" })}>
          Open Verifier
        </Link>
        <Link href={routes.legal.fairnessAudit} className={buttonClassName({ variant: "ghost", size: "sm" })}>
          View Aggregate Audit
        </Link>
      </div>
    </LegalShell>
  );
}
