"use client";

import Link from "next/link";

type AdminToolCardProps = {
  title: string;
  description: string;
  href: string;
};

export function AdminToolCard({ title, description, href }: AdminToolCardProps): JSX.Element {
  return (
    <Link
      href={href}
      className="group block rounded-pv-lg border border-pv-line bg-pv-surface-2 p-4 transition hover:border-pv-gold/60 hover:bg-pv-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-gold"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-pv-text group-hover:text-pv-gold transition-colors">
            {title}
          </h2>
          <p className="mt-1 text-sm text-pv-muted">{description}</p>
        </div>
        <span className="rounded-pv-sm border border-pv-line bg-pv-surface-3 px-2 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted transition group-hover:border-pv-gold/60 group-hover:text-pv-gold">
          Open
        </span>
      </div>
    </Link>
  );
}
