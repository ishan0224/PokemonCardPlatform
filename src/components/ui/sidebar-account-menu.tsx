"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { formatMoneyCents } from "@/lib/format";
import { routes } from "@/lib/routes";
import { useAuth } from "@/hooks/use-auth";
import { NotificationsDrawer } from "@/components/ui/notifications-drawer";
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
      <div className="rounded-xl border border-pv-border bg-white p-3 text-xs text-pv-muted" role="status" aria-live="polite">
        Loading account...
      </div>
    );
  }

  if (!user) {
    return (
      <div className="space-y-2 rounded-xl border border-pv-border bg-white p-3">
        <p className="text-xs font-medium text-pv-muted">Sign in to buy packs and bid in auctions.</p>
        <div className="grid grid-cols-2 gap-2">
          <Link href={routes.auth.login} className={buttonClassName({ variant: "secondary", size: "sm", fullWidth: true })}>
            Login
          </Link>
          <Link href={routes.auth.register} className={buttonClassName({ variant: "primary", size: "sm", fullWidth: true })}>
            Register
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-pv-border bg-white p-3">
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          size="sm"
          fullWidth
          onClick={() => {
            void refreshAuth().catch((error) => {
              console.error("Failed to refresh auth state:", error);
            });
          }}
        >
          {balance ? formatMoneyCents(balance.available) : "$0.00"}
        </Button>
        <NotificationsDrawer />
      </div>

      <details className="group rounded-lg border border-pv-border bg-pv-parchment-soft p-2">
        <summary className="cursor-pointer list-none text-sm font-semibold text-pv-ink">
          @{user.username}
        </summary>
        <div className="mt-2 space-y-2 border-t border-pv-border pt-2">
          <p className="text-xs text-pv-muted">{user.email}</p>
          <Button variant="danger" size="sm" fullWidth onClick={() => void onLogout()}>
            Logout
          </Button>
        </div>
      </details>
    </div>
  );
}
