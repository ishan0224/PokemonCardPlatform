import { LegalShell } from "@/components/ui/legal-shell";

export const revalidate = 3600;

export default function AboutPage(): JSX.Element {
  return (
    <LegalShell title="About PullVault" updatedOn="April 22, 2026">
      <p>
        PullVault is a real-time collectible experience focused on transparent pack drops, deterministic reveal mechanics,
        and market surfaces that reflect live demand.
      </p>
      <p>
        The platform combines scheduled drops, collection management, marketplace listings, and auction rooms in a single
        interface. Every pack draw is intended to be verifiable through published fairness materials.
      </p>
      <p>
        This page is placeholder product copy for internal development. It should be replaced with final company
        information, support channels, and compliance-ready disclosures before launch.
      </p>
    </LegalShell>
  );
}
