"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { formatMoneyCents } from "@/lib/format";
import { routes } from "@/lib/routes";
import { useAuth } from "@/hooks/use-auth";
import { Button, buttonClassName } from "@/components/ui/button";

export function SidebarAccountMenu(): JSX.Element {
  const router = useRouter();
  const { user, balance, loading, clearAuth, refreshAuth } = useAuth();

  const onLogout = async (): Promise<void> => {
    await apiClient.logout();
    clearAuth();
    router.push(routes.auth.login);
  };

  if (loading) {
    return (
      <div
        className="rounded-pv border border-pv-line bg-pv-surface-2 p-3 text-[12px] text-pv-muted"
        role="status"
        aria-live="polite"
      >
        Loading account…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col gap-2 rounded-pv border border-pv-line bg-pv-surface-2 p-[10px]">
        <p className="text-[12px] font-medium text-pv-muted">Sign in to buy packs and bid in auctions.</p>
        <div className="grid grid-cols-2 gap-2">
          <Link
            href={routes.auth.login}
            className={buttonClassName({ variant: "secondary", size: "sm", fullWidth: true })}
          >
            Login
          </Link>
          <Link
            href={routes.auth.register}
            className={buttonClassName({ variant: "primary", size: "sm", fullWidth: true })}
          >
            Register
          </Link>
        </div>
      </div>
    );
  }

  const initials = user.username.slice(0, 2).toUpperCase();

  return (
    <div className="flex flex-col gap-2 rounded-pv border border-pv-line bg-pv-surface-2 p-[10px]">
      {/* Balance row — clickable to refresh */}
      <button
        type="button"
        onClick={() => {
          void refreshAuth().catch((error) => {
            console.error("Failed to refresh auth state:", error);
          });
        }}
        className="flex items-center justify-between rounded-pv-sm bg-pv-surface-3 px-2.5 py-2 text-left text-[12px] font-semibold transition hover:bg-pv-surface-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-gold"
        aria-label="Refresh wallet balance"
      >
        <span className="text-pv-muted">Balance</span>
        <span className="font-extrabold tabular-nums text-pv-gold">
          {balance ? formatMoneyCents(balance.available) : "$0.00"}
        </span>
      </button>

      {/* Avatar + menu */}
      <details className="group rounded-pv-sm border border-pv-line bg-pv-surface-3 p-2">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] font-semibold text-pv-text">
          <span className="grid h-[26px] w-[26px] place-items-center rounded-full bg-gradient-to-br from-pv-gold to-pv-r-ultra text-[11px] font-black text-pv-surface">
            {initials}
          </span>
          <span className="flex-1 truncate">@{user.username}</span>
        </summary>
        <div className="mt-2 space-y-2 border-t border-pv-line pt-2">
          <p className="truncate text-[11px] text-pv-muted">{user.email}</p>
          <Button variant="danger" size="sm" fullWidth onClick={() => void onLogout()}>
            Logout
          </Button>
        </div>
      </details>
    </div>
  );
}
