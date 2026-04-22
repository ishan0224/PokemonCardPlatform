import type { ReactNode } from "react";
import { SiteFooter } from "@/components/ui/site-footer";

export default function LegalLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="min-h-screen bg-pv-surface text-pv-text">
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">{children}</main>
      <SiteFooter />
    </div>
  );
}
