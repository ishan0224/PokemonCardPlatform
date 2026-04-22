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
    <section className="w-full max-w-md rounded-pv-xl border border-pv-line bg-pv-surface-2 p-6 shadow-[0_30px_70px_-40px_rgba(0,0,0,0.8)] sm:p-7">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-pv-muted-2">
        PullVault account
      </p>
      <h1 className="mt-3 text-pv-h1">{title}</h1>
      <p className="mt-2 text-[13px] text-pv-muted">{subtitle}</p>
      <div className="mt-6">{children}</div>
      <p className="mt-5 text-[13px] text-pv-muted">
        {footerText}{" "}
        <Link href={footerLinkHref} className="font-bold text-pv-gold hover:underline">
          {footerLinkLabel}
        </Link>
      </p>
      <LegalLinks compact className="mt-4 border-t border-pv-line pt-3" />
      {auxiliaryContent ? (
        <div className="mt-5 border-t border-pv-line pt-3">{auxiliaryContent}</div>
      ) : null}
    </section>
  );
}
