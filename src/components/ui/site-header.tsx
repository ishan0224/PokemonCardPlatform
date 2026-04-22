"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { formatMoneyCents } from "@/lib/format";
import { routes } from "@/lib/routes";
import { useAuth } from "@/hooks/use-auth";

function NavLink({ href, label }: { href: string; label: string }): JSX.Element {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
        active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-200"
      }`}
    >
      {label}
    </Link>
  );
}

export function SiteHeader(): JSX.Element {
  const router = useRouter();
  const { user, balance, loading, clearAuth, refreshAuth } = useAuth();

  const onLogout = async (): Promise<void> => {
    await apiClient.logout();
    clearAuth();
    router.push(routes.auth.login);
  };

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-4">
          <Link href={routes.home} className="text-xl font-black tracking-tight text-slate-950">
            PullVault
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            <NavLink href={routes.drops.index} label="Drops" />
            <NavLink href={routes.collection.index} label="Collection" />
            <NavLink href={routes.marketplace.index} label="Marketplace" />
            <NavLink href={routes.auctions.index} label="Auctions" />
            {user?.role === "admin" ? <NavLink href={routes.admin.index} label="Admin" /> : null}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {loading ? (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">Loading...</span>
          ) : user ? (
            <>
              <button
                type="button"
                onClick={() => {
                  void refreshAuth().catch((error) => {
                    console.error("Failed to refresh auth:", error);
                  });
                }}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
              >
                {balance ? formatMoneyCents(balance.available) : "$0.00"}
              </button>
              <span className="hidden rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 sm:inline">
                @{user.username}
              </span>
              <button
                type="button"
                onClick={() => void onLogout()}
                className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white transition hover:bg-slate-700"
              >
                Logout
              </button>
            </>
          ) : (
            <>
              <Link
                href={routes.auth.login}
                className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-900 hover:text-slate-950"
              >
                Login
              </Link>
              <Link
                href={routes.auth.register}
                className="rounded-full bg-rose-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-rose-700"
              >
                Register
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
