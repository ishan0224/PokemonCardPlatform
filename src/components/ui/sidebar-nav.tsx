"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getNavSections } from "@/components/ui/nav-items";
import { routes } from "@/lib/routes";
import { isActiveNavPath, toPathname } from "@/components/ui/nav-active";
import { SidebarNavActiveSync } from "@/components/ui/sidebar-nav-active-sync";
import { SidebarAccountMenu } from "@/components/ui/sidebar-account-menu";
import { useAuth } from "@/hooks/use-auth";

type SidebarNavProps = {
  mobile?: boolean;
};

export function SidebarNav({ mobile = false }: SidebarNavProps): JSX.Element {
  const pathname = usePathname();
  const currentPath = toPathname(pathname ?? "/");
  const { user } = useAuth();
  const sections = getNavSections(user?.role ?? null);

  return (
    <aside
      className="flex h-full flex-col gap-6 px-3 py-5 text-pv-text"
      aria-label={mobile ? "Mobile navigation" : "Sidebar navigation"}
    >
      <div className="px-2 py-1">
        <Link
          href={routes.home}
          className="inline-flex items-center gap-2.5 text-[18px] font-black tracking-tight text-pv-text"
        >
          <span className="grid h-7 w-7 place-items-center rounded-pv-sm bg-gradient-to-br from-white to-pv-gold text-[14px] font-black text-pv-surface">
            PV
          </span>
          PullVault
        </Link>
      </div>

      <nav className="flex-1 space-y-6" aria-label="Primary">
        {sections.map((section) => (
          <section key={section.id} aria-label={section.label} className="space-y-0.5">
            <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-pv-muted-2">
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActiveNavPath(currentPath, item.href);

                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      data-nav-link="true"
                      data-nav-href={item.href}
                      data-active={active ? "true" : "false"}
                      aria-current={active ? "page" : undefined}
                      className="group flex min-h-11 items-center gap-2.5 rounded-[10px] px-3 py-[9px] text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-gold focus-visible:ring-offset-2 focus-visible:ring-offset-[#08080b] data-[active=true]:bg-pv-gold-soft data-[active=true]:text-pv-gold data-[active=true]:shadow-[inset_0_0_0_1px_rgba(255,234,155,0.18)] data-[active=false]:text-pv-muted data-[active=false]:hover:bg-pv-surface-2 data-[active=false]:hover:text-pv-text"
                    >
                      <span className="flex-1">{item.label}</span>
                      {item.stub ? (
                        <span className="rounded-full bg-pv-surface-3 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-pv-muted group-data-[active=true]:bg-white/15 group-data-[active=true]:text-pv-gold">
                          Soon
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </nav>

      <div className="mt-auto">
        <SidebarAccountMenu />
      </div>
      <SidebarNavActiveSync />
    </aside>
  );
}
