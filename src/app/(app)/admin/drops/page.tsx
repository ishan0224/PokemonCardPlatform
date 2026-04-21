import Link from "next/link";
import { buttonClassName } from "@/components/ui/button-styles";
import { AdminDropPublishButton } from "@/components/admin/admin-drop-publish-button";
import { formatDateTime, formatMoneyCents } from "@/lib/format";
import { routes } from "@/lib/routes";
import { useSession } from "@/server/auth/session";
import { listAdminDrops, type AdminDropStatus, type AdminDropView } from "@/server/services/admin-drop.service";

const STATUS_ORDER: AdminDropStatus[] = ["draft", "upcoming", "active", "completed", "cancelled"];

const STATUS_LABELS: Record<AdminDropStatus, string> = {
  draft: "Draft",
  upcoming: "Upcoming",
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled"
};

const STATUS_THEME: Record<AdminDropStatus, string> = {
  draft: "bg-slate-100 text-slate-800",
  upcoming: "bg-indigo-100 text-indigo-800",
  active: "bg-emerald-100 text-emerald-800",
  completed: "bg-sky-100 text-sky-800",
  cancelled: "bg-rose-100 text-rose-800"
};

function groupByStatus(drops: AdminDropView[]): Record<AdminDropStatus, AdminDropView[]> {
  const grouped: Record<AdminDropStatus, AdminDropView[]> = {
    draft: [],
    upcoming: [],
    active: [],
    completed: [],
    cancelled: []
  };

  for (const drop of drops) {
    grouped[drop.status].push(drop);
  }

  return grouped;
}

export default async function AdminDropsPage(): Promise<JSX.Element> {
  const session = await useSession();

  if (!session.isAuthenticated || !session.user) {
    return (
      <section className="rounded-2xl border border-pv-border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-black text-pv-ink">Admin Drops</h1>
        <p className="mt-2 text-sm text-pv-muted">Sign in with an admin account to manage drops.</p>
        <Link href={routes.auth.login} className={`${buttonClassName({ variant: "primary" })} mt-4`}>
          Go to Login
        </Link>
      </section>
    );
  }

  if (session.user.role !== "admin") {
    return (
      <section className="rounded-2xl border border-pv-border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-black text-pv-ink">Forbidden</h1>
        <p className="mt-2 text-sm text-pv-muted">Your account is not authorized to access admin drops.</p>
      </section>
    );
  }

  const { items } = await listAdminDrops({ limit: 60 });
  const grouped = groupByStatus(items);

  return (
    <section className="space-y-6">
      <header className="rounded-2xl border border-pv-border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black text-pv-ink">Admin Drops</h1>
            <p className="mt-1 text-sm text-pv-muted">
              Schedule new drops, configure pack composition, and publish after readiness checks pass.
            </p>
          </div>
          <Link href={routes.admin.dropsNew} className={buttonClassName({ variant: "primary" })}>
            Schedule Drop
          </Link>
        </div>
      </header>

      {STATUS_ORDER.map((status) => {
        const sectionItems = grouped[status];
        if (sectionItems.length === 0) {
          return null;
        }

        return (
          <section key={status} className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black text-pv-ink">{STATUS_LABELS[status]}</h2>
              <span className="rounded-full bg-pv-parchment-soft px-2 py-0.5 text-xs font-semibold text-pv-muted">
                {sectionItems.length}
              </span>
            </div>

            <div className="grid gap-3">
              {sectionItems.map((drop) => {
                const canEdit = drop.status === "draft" || drop.status === "upcoming";

                return (
                  <article key={drop.id} className="rounded-2xl border border-pv-border bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-bold text-pv-ink">{drop.name}</h3>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_THEME[drop.status]}`}>
                            {STATUS_LABELS[drop.status]}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-pv-muted">
                          ID {drop.id.slice(0, 8)} · scheduled {formatDateTime(drop.scheduledAt)}
                        </p>
                        <p className="mt-1 text-xs text-pv-muted">
                          Max/user {drop.maxPacksPerUser} · lottery {drop.lotteryEnabled ? "enabled" : "disabled"}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {canEdit ? (
                          <Link href={routes.admin.dropsEdit(drop.id)} className={buttonClassName({ variant: "secondary", size: "sm" })}>
                            Edit
                          </Link>
                        ) : (
                          <span className="rounded-lg border border-pv-border px-2 py-1 text-xs text-pv-muted">Locked</span>
                        )}
                        {drop.status === "draft" ? <AdminDropPublishButton dropId={drop.id} /> : null}
                      </div>
                    </div>

                    <div className="mt-3 grid gap-2 text-xs text-pv-muted sm:grid-cols-2 lg:grid-cols-4">
                      <div className="rounded-lg bg-pv-parchment-soft p-2">
                        <p className="uppercase tracking-wide">Inventory</p>
                        <p className="mt-1 font-semibold text-pv-ink">
                          {drop.inventory.remaining}/{drop.inventory.total} remaining
                        </p>
                        <p>Consumed {drop.inventory.consumed}</p>
                      </div>
                      <div className="rounded-lg bg-pv-parchment-soft p-2">
                        <p className="uppercase tracking-wide">Lottery</p>
                        <p className="mt-1">Wins {drop.lottery.wins}</p>
                        <p>Losses {drop.lottery.losses}</p>
                        <p>Unavailable {drop.lottery.unavailable}</p>
                      </div>
                      <div className="rounded-lg bg-pv-parchment-soft p-2">
                        <p className="uppercase tracking-wide">Scheduler</p>
                        <p className="mt-1">Issues {drop.scheduler.issueCount}</p>
                        <p>{drop.scheduler.lastIssueAt ? `Last ${formatDateTime(drop.scheduler.lastIssueAt)}` : "No recorded issues"}</p>
                      </div>
                      <div className="rounded-lg bg-pv-parchment-soft p-2">
                        <p className="uppercase tracking-wide">Tier Pricing</p>
                        {drop.tiers.map((tier) => (
                          <p key={tier.tier}>
                            {tier.tier}: {formatMoneyCents(tier.price)}
                          </p>
                        ))}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}

      {items.length === 0 ? (
        <section className="rounded-2xl border border-pv-border bg-white p-6 text-sm text-pv-muted shadow-sm">
          No drops scheduled yet. Create your first drop to configure inventory and composition.
        </section>
      ) : null}
    </section>
  );
}
