"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

function shouldHideFooter(pathname: string): boolean {
  return /^\/packs\/[^/]+\/reveal$/.test(pathname);
}

export function SiteFooterVisibility({ children }: { children: ReactNode }): JSX.Element | null {
  const pathname = usePathname() ?? "/";

  if (shouldHideFooter(pathname)) {
    return null;
  }

  return <>{children}</>;
}
