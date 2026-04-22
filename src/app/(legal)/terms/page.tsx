import { LegalShell } from "@/components/ui/legal-shell";

export const revalidate = 3600;

export default function TermsPage(): JSX.Element {
  return (
    <LegalShell title="Terms of Service" updatedOn="April 22, 2026">
      <p>
        These terms describe the draft rules for using PullVault, including account eligibility, acceptable behavior, and
        how virtual balances and digital assets are handled in development environments.
      </p>
      <p>
        You are responsible for keeping your credentials safe and for activity under your account. You must not abuse the
        platform, automate prohibited actions, exploit bugs, or interfere with fair access to drops and auctions.
      </p>
      <p>
        PullVault may suspend access to protect platform integrity, investigate fraud, or enforce policy. Availability,
        features, and pricing models may change during testing without notice.
      </p>
      <p>
        This page is not legal advice and does not create final contractual language. Product and legal teams must replace
        this placeholder before public release.
      </p>
    </LegalShell>
  );
}
