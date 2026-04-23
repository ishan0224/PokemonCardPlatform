"use client";

import Link from "next/link";
import { formatMoneyCents } from "@/lib/format";
import { routes } from "@/lib/routes";
import { useAuth } from "@/hooks/use-auth";

export function MobileAccountBadge(): JSX.Element | null {
  const { user, balance, loading, refreshAuth } = useAuth();

  if (loading) {
    return (
      <span
        className="inline-flex h-9 items-center rounded-pv-sm border border-pv-line bg-pv-surface-2 px-2.5 text-[11px] font-semibold text-pv-muted"
        role="status"
        aria-live="polite"
      >
        Loading…
      </span>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center gap-1.5">
        <Link
          href={routes.auth.login}
          className="inline-flex h-9 items-center rounded-pv-sm border border-pv-line bg-pv-surface-2 px-2.5 text-[11px] font-semibold text-pv-text transition hover:bg-pv-surface-3"
        >
          Login
        </Link>
      </div>
    );
  }

  const initials = user.username.slice(0, 2).toUpperCase();
  const balanceLabel = balance ? formatMoneyCents(balance.available) : "$0.00";

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => {
          void refreshAuth().catch((error) => {
            console.error("Failed to refresh auth state:", error);
          });
        }}
        aria-label={`Balance ${balanceLabel}. Tap to refresh.`}
        className="inline-flex h-9 items-center rounded-pv-sm border border-pv-line bg-pv-surface-2 px-2.5 font-extrabold tabular-nums text-[12px] text-pv-gold transition hover:bg-pv-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-gold"
      >
        {balanceLabel}
      </button>
      <span
        className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-pv-gold to-pv-r-ultra text-[12px] font-black text-pv-surface"
        aria-label={`Signed in as ${user.username}`}
        title={`@${user.username}`}
      >
        {initials}
      </span>
    </div>
  );
}
