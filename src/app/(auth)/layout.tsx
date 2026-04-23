import type { ReactNode } from "react";
import { AppShell } from "@/components/ui/app-shell";

export default async function AuthLayout({ children }: { children: ReactNode }): Promise<JSX.Element> {
  return (
    <AppShell>
      <div
        className="mx-auto flex min-h-[70vh] w-full max-w-6xl items-center justify-center"
        aria-label="Authentication"
      >
        {children}
      </div>
    </AppShell>
  );
}
