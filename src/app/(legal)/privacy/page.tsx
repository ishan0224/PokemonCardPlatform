import { LegalShell } from "@/components/ui/legal-shell";

export const revalidate = 3600;

export default function PrivacyPage(): JSX.Element {
  return (
    <LegalShell title="Privacy Policy" updatedOn="April 22, 2026">
      <p>
        This draft policy explains what information PullVault collects during account creation and platform usage, how that
        data is used to operate the product, and how long records may be retained.
      </p>
      <p>
        We collect core account fields, session metadata, and operational telemetry needed for fraud prevention, performance
        diagnostics, and fairness verification. We do not treat this placeholder as final legal language.
      </p>
      <p>
        Data may be processed by service providers that support hosting, authentication, and observability. Access to
        sensitive systems is limited to authorized personnel on a need-to-know basis.
      </p>
      <p>
        Replace this text with reviewed jurisdiction-specific disclosures and formal rights language before production
        rollout.
      </p>
    </LegalShell>
  );
}
