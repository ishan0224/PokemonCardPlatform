"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getNavSections } from "@/components/ui/nav-items";
import { isActiveNavPath, toPathname } from "@/components/ui/nav-active";
import { useAuth } from "@/hooks/use-auth";

export function MobileBottomNav(): JSX.Element {
  const pathname = usePathname();
  const currentPath = toPathname(pathname ?? "/");
  const { user } = useAuth();
  const primaryItems = getNavSections(user?.role ?? null)[0]?.items ?? [];

  return (
    <nav
      aria-label="Bottom navigation"
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-pv-line bg-pv-surface/90 px-2 py-2 backdrop-blur-md md:hidden"
    >
      <ul className="flex items-center gap-2 overflow-x-auto">
        {primaryItems.map((item) => {
          const active = isActiveNavPath(currentPath, item.href);

          return (
            <li key={item.id} className="min-w-fit flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center justify-center rounded-pv-sm px-3 text-xs font-semibold transition ${
                  active
                    ? "bg-pv-gold-soft text-pv-gold shadow-[inset_0_0_0_1px_rgba(255,234,155,0.2)]"
                    : "text-pv-muted hover:bg-pv-surface-2 hover:text-pv-text"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
