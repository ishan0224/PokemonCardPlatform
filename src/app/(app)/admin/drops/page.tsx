import Link from "next/link";
import { buttonClassName } from "@/components/ui/button-styles";
import { AdminDropPublishButton } from "@/components/admin/admin-drop-publish-button";
import { Chip } from "@/components/ui/chip";
import { StatTile } from "@/components/ui/stat-tile";
import { formatDateTime } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { PackTier, RarityTier } from "@/lib/types";
import { useSession } from "@/server/auth/session";
import { listAdminDrops, type AdminDropStatus, type AdminDropView } from "@/server/services/admin-drop.service";

const STATUS_LABELS: Record<AdminDropStatus, string> = {
  draft: "Draft",
  upcoming: "Upcoming",
  active: "Live",
  completed: "Completed",
  cancelled: "Cancelled"
};

function statusChip(status: AdminDropStatus): JSX.Element {
  if (status === "active") return <Chip tone="live" pulse>Live</Chip>;
  if (status === "upcoming") return <Chip tone="upcoming">Upcoming</Chip>;
  if (status === "completed") return <Chip tone="completed">Completed</Chip>;
  if (status === "cancelled") return <Chip tone="neutral">Cancelled</Chip>;
  return <Chip tone="neutral">Draft</Chip>;
}

const TIER_RARITY: Record<PackTier, RarityTier> = {
  standard: "common",
  premium: "rare",
  elite: "chase"
};

const TIER_SHORT: Record<PackTier, string> = {
  standard: "Std",
  premium: "Prem",
  elite: "Elite"
};

const TIER_CLASSNAME: Record<RarityTier, string> = {
  common: "bg-[rgba(154,163,178,0.14)] text-pv-r-common",
  uncommon: "bg-[rgba(16,185,129,0.14)] text-pv-r-uncommon",
  rare: "bg-[rgba(56,189,248,0.14)] text-pv-r-rare",
  holo_rare: "bg-[rgba(167,139,250,0.18)] text-pv-r-holo",
  ultra_rare: "bg-[rgba(244,114,182,0.18)] text-pv-r-ultra",
  chase: "bg-gradient-to-br from-[rgba(255,234,155,0.2)] to-[rgba(255,130,169,0.2)] text-pv-gold"
};

function countBy(drops: AdminDropView[], status: AdminDropStatus): number {
  return drops.filter((drop) => drop.status === status).length;
}

export default async function AdminDropsPage(): Promise<JSX.Element> {
  const session = await useSession();

  if (!session.isAuthenticated || !session.user) {
    return (
      <section className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-6">
        <h1 className="text-pv-h1">Admin · Drops</h1>
        <p className="mt-2 text-[13px] text-pv-muted">Sign in with an admin account to manage drops.</p>
        <Link
          href={routes.auth.login}
          className={`${buttonClassName({ variant: "primary", size: "sm" })} mt-4`}
        >
          Go to login
        </Link>
      </section>
    );
  }

  if (session.user.role !== "admin") {
    return (
      <section className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-6">
        <h1 className="text-pv-h1">Forbidden</h1>
        <p className="mt-2 text-[13px] text-pv-muted">
          Your account is not authorised to access admin drops.
        </p>
      </section>
    );
  }

  const { items } = await listAdminDrops({ limit: 60 });
  const activeCount = countBy(items, "active");
  const upcomingCount = countBy(items, "upcoming");
  const draftCount = countBy(items, "draft");

  return (
    <section className="space-y-5">
      {/* HEADER */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-pv-h1">Drop scheduler</h1>
          <p className="mt-1 text-[13px] text-pv-muted">
            Draft → Upcoming → Active → Completed. Publish gate validates readiness.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatTile
            label="Active"
            value={activeCount}
            valueClassName="text-[18px]"
            className="p-[10px_14px]"
          />
          <StatTile
            label="Upcoming"
            value={upcomingCount}
            valueClassName="text-[18px]"
            className="p-[10px_14px]"
          />
          <StatTile
            label="Drafts"
            value={draftCount}
            valueClassName="text-[18px]"
            className="p-[10px_14px]"
          />
          <Link
            href={routes.admin.dropsNew}
            className={buttonClassName({ variant: "primary", size: "sm" })}
          >
            + New drop
          </Link>
        </div>
      </header>

      {/* TABLE */}
      <section className="overflow-hidden rounded-pv-lg border border-pv-line bg-pv-surface-2">
        {items.length === 0 ? (
          <p className="p-5 text-sm text-pv-muted">
            No drops scheduled yet. Create your first drop to configure inventory and composition.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted-2">
                  <th className="border-b border-pv-line px-3 py-3">Name</th>
                  <th className="border-b border-pv-line px-3 py-3">Status</th>
                  <th className="border-b border-pv-line px-3 py-3">Scheduled</th>
                  <th className="border-b border-pv-line px-3 py-3">Tiers</th>
                  <th className="border-b border-pv-line px-3 py-3">Inventory</th>
                  <th className="border-b border-pv-line px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {items.map((drop) => {
                  const canEdit = drop.status === "draft" || drop.status === "upcoming";
                  return (
                    <tr key={drop.id} className="border-b border-pv-line last:border-b-0">
                      <td className="px-3 py-3">
                        <div className="font-bold text-pv-text">{drop.name}</div>
                        <div className="font-mono text-[11px] text-pv-muted">
                          {drop.id.slice(0, 8)}…
                        </div>
                      </td>
                      <td className="px-3 py-3">{statusChip(drop.status)}</td>
                      <td className="px-3 py-3 text-pv-muted">
                        {drop.scheduledAt ? formatDateTime(drop.scheduledAt) : "— not scheduled"}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap items-center gap-1">
                          {drop.tiers.map((tier) => (
                            <span
                              key={tier.tier}
                              className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.08em] ${TIER_CLASSNAME[TIER_RARITY[tier.tier]]}`}
                            >
                              {TIER_SHORT[tier.tier]}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-3 tabular-nums text-pv-text">
                        {drop.inventory.consumed} / {drop.inventory.total}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {canEdit ? (
                            <Link
                              href={routes.admin.dropsEdit(drop.id)}
                              className={buttonClassName({ variant: "secondary", size: "xs" })}
                            >
                              Edit
                            </Link>
                          ) : (
                            <Link
                              href={routes.drops.detail(drop.id)}
                              className={buttonClassName({ variant: "secondary", size: "xs" })}
                            >
                              View
                            </Link>
                          )}
                          {drop.status === "draft" ? <AdminDropPublishButton dropId={drop.id} /> : null}
                          {drop.status === "upcoming" ? (
                            <span className="inline-flex min-h-8 items-center rounded-pv-sm border border-pv-line px-2.5 py-1 text-[11px] text-pv-muted">
                              Locked
                            </span>
                          ) : null}
                          {drop.status === "completed" ? (
                            <span className="inline-flex min-h-8 items-center rounded-pv-sm border border-pv-line px-2.5 py-1 text-[11px] text-pv-muted">
                              Archive
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
