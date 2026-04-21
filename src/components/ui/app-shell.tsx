import Link from "next/link";
import type { ReactNode } from "react";
import { MobileNavDrawer } from "@/components/ui/mobile-nav-drawer";
import { SidebarNav } from "@/components/ui/sidebar-nav";
import { routes } from "@/lib/routes";

export async function AppShell({ children }: { children: ReactNode }): Promise<JSX.Element> {
  return (
    <div className="min-h-screen bg-pv-parchment text-pv-ink antialiased">
      <div className="mx-auto flex w-full max-w-[1600px]">
        <aside className="sticky top-0 hidden h-screen w-64 border-r border-pv-border bg-pv-parchment lg:block">
          <SidebarNav />
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between border-b border-pv-border bg-pv-parchment/95 px-4 backdrop-blur lg:hidden">
            <Link href={routes.home} className="text-lg font-black tracking-tight text-pv-ink">
              PullVault
            </Link>
            <MobileNavDrawer>
              <SidebarNav mobile />
            </MobileNavDrawer>
          </header>

          <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
