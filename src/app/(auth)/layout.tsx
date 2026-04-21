import type { ReactNode } from "react";
import { SiteFooter } from "@/components/ui/site-footer";

export default function AuthLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="min-h-screen bg-pv-parchment">
      <main className="px-4 py-10 sm:px-6 lg:px-8" aria-label="Authentication">
        <div className="mx-auto flex min-h-[70vh] w-full max-w-6xl items-center justify-center">{children}</div>
      </main>
      <div className="mt-auto">
        <SiteFooter />
      </div>
    </div>
  );
}
