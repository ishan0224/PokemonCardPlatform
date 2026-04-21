"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { isActiveNavPath, toPathname } from "@/components/ui/nav-active";

export function SidebarNavActiveSync(): null {
  const pathname = usePathname();

  useEffect(() => {
    const currentPath = toPathname(pathname ?? "/");
    const navLinks = document.querySelectorAll<HTMLAnchorElement>("[data-nav-link='true']");

    for (const link of navLinks) {
      const href = link.getAttribute("data-nav-href");
      if (!href) {
        continue;
      }

      const active = isActiveNavPath(currentPath, href);
      link.dataset.active = active ? "true" : "false";

      if (active) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    }
  }, [pathname]);

  return null;
}
