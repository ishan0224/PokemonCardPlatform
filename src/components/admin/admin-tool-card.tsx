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
      className="group rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:bg-slate-50"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
        </div>
        <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600 transition group-hover:border-slate-300">
          Open
        </span>
      </div>
    </Link>
  );
}
