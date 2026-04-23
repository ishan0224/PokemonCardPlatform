"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getNavSections } from "@/components/ui/nav-items";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api-client";
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
  const router = useRouter();
  const currentPath = toPathname(pathname ?? "/");
  const { user, clearAuth } = useAuth();
  const sections = getNavSections(user?.role ?? null);

  const onMobileLogout = async (): Promise<void> => {
    try {
      await apiClient.logout();
    } finally {
      clearAuth();
      router.push(routes.auth.login);
    }
  };

  return (
    <aside
      className="flex h-full flex-col gap-6 px-3 py-5 text-pv-text"
      aria-label={mobile ? "Mobile navigation" : "Sidebar navigation"}
    >
      {!mobile ? (
        <div className="flex justify-center py-1">
          <Link
            href={routes.home}
            aria-label="PullVault home"
            className="inline-flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-gold rounded-pv-sm"
          >
            <Logo height={108} priority />
          </Link>
        </div>
      ) : null}

      <nav className="min-h-0 flex-1 space-y-6 overflow-y-auto" aria-label="Primary">
        {sections.map((section) => (
          <section key={section.id} aria-label={section.label} className="space-y-0.5">
            <p className="px-3 pb-1.5 text-[11px] font-extrabold uppercase tracking-[0.18em] text-pv-gold">
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
        {mobile ? (
          user ? (
            <Button variant="danger" size="md" fullWidth onClick={() => void onMobileLogout()}>
              Logout
            </Button>
          ) : null
        ) : (
          <SidebarAccountMenu />
        )}
      </div>
      <SidebarNavActiveSync />
    </aside>
  );
}
