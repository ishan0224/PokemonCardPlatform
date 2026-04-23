import { routes } from "@/lib/routes";

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === "/") {
    return routes.home;
  }

  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }

  return pathname;
}

export function toPathname(rawUrl: string | null): string {
  if (!rawUrl) {
    return routes.home;
  }

  try {
    if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
      return normalizePathname(new URL(rawUrl).pathname || routes.home);
    }

    if (rawUrl.startsWith("/")) {
      return normalizePathname(new URL(rawUrl, "http://localhost").pathname || routes.home);
    }
  } catch (_error) {
    return routes.home;
  }

  return routes.home;
}

export function isActiveNavPath(currentPath: string, href: string): boolean {
  const normalizedCurrentPath = normalizePathname(currentPath);
  const normalizedHref = normalizePathname(href);

  // Exact-match only for index routes (home and admin home) to prevent
  // child routes from also highlighting the parent nav item
  if (normalizedHref === routes.home || normalizedHref === routes.admin.index) {
    return normalizedCurrentPath === normalizedHref;
  }

  return normalizedCurrentPath === normalizedHref || normalizedCurrentPath.startsWith(`${normalizedHref}/`);
}
