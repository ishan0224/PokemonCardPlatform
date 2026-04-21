import Link from "next/link";
import type { ReactNode } from "react";
import { MobileBottomNav } from "@/components/ui/mobile-bottom-nav";
import { MobileNavDrawer } from "@/components/ui/mobile-nav-drawer";
import { NotificationsDrawer } from "@/components/ui/notifications-drawer";
import { SiteFooter } from "@/components/ui/site-footer";
import { SiteFooterVisibility } from "@/components/ui/site-footer-visibility";
import { SidebarNav } from "@/components/ui/sidebar-nav";
import { routes } from "@/lib/routes";

export async function AppShell({ children }: { children: ReactNode }): Promise<JSX.Element> {
  return (
    <div className="min-h-screen bg-pv-parchment text-pv-ink antialiased">
      <div className="mx-auto flex w-full max-w-[1600px]">
        <aside className="sticky top-0 hidden h-screen w-64 border-r border-pv-border bg-pv-parchment md:block">
          <SidebarNav />
        </aside>

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between border-b border-pv-border bg-pv-parchment/95 px-4 backdrop-blur md:hidden">
            <Link href={routes.home} className="text-lg font-black tracking-tight text-pv-ink">
              PullVault
            </Link>
            <div className="flex items-center gap-2">
              <NotificationsDrawer />
              <MobileNavDrawer>
                <SidebarNav mobile />
              </MobileNavDrawer>
            </div>
          </header>

          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 pb-24 sm:px-6 md:pb-6 lg:px-8">{children}</main>
          <SiteFooterVisibility>
            <SiteFooter />
          </SiteFooterVisibility>
        </div>
      </div>
      <MobileBottomNav />
    </div>
  );
}
