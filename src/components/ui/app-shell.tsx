import Link from "next/link";
import type { ReactNode } from "react";
import { MobileBottomNav } from "@/components/ui/mobile-bottom-nav";
import { MobileNavDrawer } from "@/components/ui/mobile-nav-drawer";
import { SiteFooter } from "@/components/ui/site-footer";
import { SiteFooterVisibility } from "@/components/ui/site-footer-visibility";
import { SidebarNav } from "@/components/ui/sidebar-nav";
import { routes } from "@/lib/routes";

export async function AppShell({ children }: { children: ReactNode }): Promise<JSX.Element> {
  return (
    <div className="min-h-screen bg-pv-surface text-pv-text antialiased">
      <div className="mx-auto flex w-full max-w-[1600px]">
        <aside
          className="sticky top-0 hidden h-screen w-60 border-r border-pv-line bg-[#08080b] md:block"
          aria-label="Primary navigation"
        >
          <SidebarNav />
        </aside>

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between border-b border-pv-line bg-pv-surface/80 px-4 backdrop-blur-md md:hidden">
            <Link
              href={routes.home}
              className="flex items-center gap-2 text-lg font-black tracking-tight text-pv-text"
            >
              <span className="grid h-7 w-7 place-items-center rounded-pv-sm bg-gradient-to-br from-white to-pv-gold text-[14px] font-black text-pv-surface">
                PV
              </span>
              PullVault
            </Link>
            <MobileNavDrawer>
              <SidebarNav mobile />
            </MobileNavDrawer>
          </header>

          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 pb-24 sm:px-6 md:pb-6 lg:px-7">
            {children}
          </main>
          <SiteFooterVisibility>
            <SiteFooter />
          </SiteFooterVisibility>
        </div>
      </div>
      <MobileBottomNav />
    </div>
  );
}
