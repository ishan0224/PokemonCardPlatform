"use client";

import Link from "next/link";
import { buttonClassName } from "@/components/ui/button";

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
        <Link href={action.href} className={`${buttonClassName({ variant: "primary" })} mt-4`}>
          {action.label}
        </Link>
      ) : null}
    </section>
  );
}
