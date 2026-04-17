import Link from "next/link";
import type { ReactNode } from "react";

type AuthShellProps = {
  title: string;
  subtitle: string;
  footerText: string;
  footerLinkLabel: string;
  footerLinkHref: string;
  children: ReactNode;
};

export function AuthShell({
  title,
  subtitle,
  footerText,
  footerLinkLabel,
  footerLinkHref,
  children
}: AuthShellProps): JSX.Element {
  return (
    <section className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-3xl font-black text-slate-950">{title}</h1>
      <p className="mt-2 text-sm text-slate-600">{subtitle}</p>
      <div className="mt-6">{children}</div>
      <p className="mt-5 text-sm text-slate-600">
        {footerText}{" "}
        <Link href={footerLinkHref} className="font-bold text-rose-700 hover:text-rose-900">
          {footerLinkLabel}
        </Link>
      </p>
    </section>
  );
}
