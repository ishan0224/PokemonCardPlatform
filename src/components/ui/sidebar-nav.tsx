import Link from "next/link";
import { headers } from "next/headers";
import { getNavSections } from "@/components/ui/nav-items";
import { routes } from "@/lib/routes";
import { useSession } from "@/server/auth/session";
import { isActiveNavPath, toPathname } from "@/components/ui/nav-active";
import { SidebarNavActiveSync } from "@/components/ui/sidebar-nav-active-sync";
import { SidebarAccountMenu } from "@/components/ui/sidebar-account-menu";

type SidebarNavProps = {
  mobile?: boolean;
};

function readCurrentPathname(): string {
  const incomingHeaders = headers();

  const candidate =
    incomingHeaders.get("x-pathname") ??
    incomingHeaders.get("next-url") ??
    incomingHeaders.get("x-url");

  return toPathname(candidate);
}

export async function SidebarNav({ mobile = false }: SidebarNavProps): Promise<JSX.Element> {
  const session = await useSession();
  const sections = getNavSections(session.user?.role ?? null);
  const currentPath = readCurrentPathname();

  return (
    <aside className="flex h-full flex-col" aria-label={mobile ? "Mobile navigation" : "Sidebar navigation"}>
      <div className="px-4 pb-3 pt-4">
        <Link href={routes.home} className="inline-flex items-center text-xl font-black tracking-tight text-pv-ink">
          PullVault
        </Link>
      </div>

      <nav className="flex-1 space-y-5 px-3" aria-label="Primary">
        {sections.map((section) => (
          <section key={section.id} aria-label={section.label}>
            <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-pv-muted">{section.label}</p>
            <ul className="mt-2 space-y-1">
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
                      className="group flex min-h-11 items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-accent focus-visible:ring-offset-2 focus-visible:ring-offset-pv-parchment data-[active=true]:bg-pv-accent data-[active=true]:text-white data-[active=false]:text-pv-ink data-[active=false]:hover:bg-pv-parchment-soft"
                    >
                      <span>{item.label}</span>
                      {item.stub ? (
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide group-data-[active=true]:bg-white/20 group-data-[active=true]:text-white group-data-[active=false]:bg-pv-parchment-soft group-data-[active=false]:text-pv-muted"
                        >
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

      <div className="mt-4 border-t border-pv-border p-3">
        <SidebarAccountMenu />
      </div>
      <SidebarNavActiveSync />
    </aside>
  );
}
