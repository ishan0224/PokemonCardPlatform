import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui/logo";
import { MobileAccountBadge } from "@/components/ui/mobile-account-badge";
import { MobileNavDrawer } from "@/components/ui/mobile-nav-drawer";
import { SiteFooter } from "@/components/ui/site-footer";
import { SiteFooterVisibility } from "@/components/ui/site-footer-visibility";
import { SidebarNav } from "@/components/ui/sidebar-nav";
import { routes } from "@/lib/routes";

export async function AppShell({ children }: { children: ReactNode }): Promise<JSX.Element> {
  return (
    <div className="min-h-screen bg-pv-surface text-pv-text antialiased">
      <div className="flex w-full">
        <aside
          className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-pv-line bg-[#08080b] md:block"
          aria-label="Primary navigation"
        >
          <SidebarNav />
        </aside>

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-[80] flex min-h-16 items-center justify-between gap-2 border-b border-pv-line bg-pv-surface px-3 md:hidden">
            <div className="flex items-center gap-2">
              <MobileNavDrawer>
                <SidebarNav mobile />
              </MobileNavDrawer>
              <Link
                href={routes.home}
                aria-label="PullVault home"
                className="inline-flex items-center gap-2 rounded-pv-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-gold"
              >
                <Logo height={44} />
                <span className="text-[15px] font-black tracking-tight text-pv-text">
                  PullVault
                </span>
              </Link>
            </div>
            <MobileAccountBadge />
          </header>

          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 md:pb-6 lg:px-7">
            {children}
          </main>
          <SiteFooterVisibility>
            <SiteFooter />
          </SiteFooterVisibility>
        </div>
      </div>
    </div>
  );
}
