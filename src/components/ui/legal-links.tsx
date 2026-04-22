import Link from "next/link";
import { routes } from "@/lib/routes";

type LegalLinksProps = {
  className?: string;
  compact?: boolean;
};

function cx(...parts: Array<string | undefined | null | false>): string {
  return parts.filter(Boolean).join(" ");
}

export function LegalLinks({ className, compact = false }: LegalLinksProps): JSX.Element {
  const linkClassName = compact
    ? "text-xs font-medium text-pv-muted hover:text-pv-ink"
    : "text-sm text-pv-muted hover:text-pv-ink";

  return (
    <nav
      aria-label="Legal links"
      className={cx(
        "flex flex-wrap items-center gap-x-4 gap-y-1",
        compact ? "justify-center" : undefined,
        className
      )}
    >
      <Link href={routes.legal.terms} className={linkClassName}>
        Terms
      </Link>
      <Link href={routes.legal.privacy} className={linkClassName}>
        Privacy
      </Link>
      <Link href={routes.legal.about} className={linkClassName}>
        About
      </Link>
      <Link href={routes.legal.fairnessExplainer} className={linkClassName}>
        Fairness
      </Link>
    </nav>
  );
}
