"use client";

import Link from "next/link";

type StatusPanelProps = {
  title: string;
  message?: string;
  action?: {
    label: string;
    href: string;
  };
};

export function StatusPanel({ title, message, action }: StatusPanelProps): JSX.Element {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-black text-slate-900">{title}</h1>
      {message ? <p className="mt-2 text-sm text-slate-600">{message}</p> : null}
      {action ? (
        <Link
          href={action.href}
          className="mt-4 inline-flex rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-700"
        >
          {action.label}
        </Link>
      ) : null}
    </section>
  );
}
