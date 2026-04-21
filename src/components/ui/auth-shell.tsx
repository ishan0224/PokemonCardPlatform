import Link from "next/link";
import type { ReactNode } from "react";
import { LegalLinks } from "@/components/ui/legal-links";

type AuthShellProps = {
  title: string;
  subtitle: string;
  footerText: string;
  footerLinkLabel: string;
  footerLinkHref: string;
  children: ReactNode;
  auxiliaryContent?: ReactNode;
};

export function AuthShell({
  title,
  subtitle,
  footerText,
  footerLinkLabel,
  footerLinkHref,
  children,
  auxiliaryContent
}: AuthShellProps): JSX.Element {
  return (
    <section className="w-full max-w-md rounded-3xl border border-pv-border bg-white p-6 shadow-[0_30px_70px_-40px_rgba(20,23,31,0.55)] sm:p-7">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-pv-muted">PullVault account</p>
      <h1 className="mt-3 text-3xl font-black text-pv-ink">{title}</h1>
      <p className="mt-2 text-sm text-pv-muted">{subtitle}</p>
      <div className="mt-6">{children}</div>
      <p className="mt-5 text-sm text-pv-muted">
        {footerText}{" "}
        <Link href={footerLinkHref} className="font-semibold text-pv-accent hover:text-pv-accent-strong">
          {footerLinkLabel}
        </Link>
      </p>
      <LegalLinks compact className="mt-4 border-t border-pv-border pt-3" />
      {auxiliaryContent ? <div className="mt-5 border-t border-pv-border pt-3">{auxiliaryContent}</div> : null}
    </section>
  );
}
