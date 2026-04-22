import Link from "next/link";
import dynamic from "next/dynamic";
import { buttonClassName } from "@/components/ui/button-styles";
import type { AdminDropMutationInput } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { routes } from "@/lib/routes";
import { useSession } from "@/server/auth/session";
import { getAdminDropById, previewAdminDropComposition } from "@/server/services/admin-drop.service";

const AdminDropEditor = dynamic(
  () => import("@/components/admin/admin-drop-editor").then((module) => module.AdminDropEditor),
  { ssr: false }
);

export default async function AdminDropEditPage(
  props: { params: { id: string } }
): Promise<JSX.Element> {
  const session = await useSession();

  if (!session.isAuthenticated || !session.user) {
    return (
      <section className="rounded-2xl border border-pv-border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-black text-pv-ink">Admin Drops</h1>
        <p className="mt-2 text-sm text-pv-muted">Sign in with an admin account to edit drops.</p>
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

  const drop = await getAdminDropById(props.params.id);

  if (!drop) {
    return (
      <section className="rounded-2xl border border-pv-border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-black text-pv-ink">Drop not found</h1>
        <p className="mt-2 text-sm text-pv-muted">The requested drop could not be found.</p>
        <Link href={routes.admin.drops} className={`${buttonClassName({ variant: "secondary" })} mt-4`}>
          Back to drops
        </Link>
      </section>
    );
  }

  if (drop.status !== "draft" && drop.status !== "upcoming") {
    return (
      <section className="rounded-2xl border border-pv-border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-black text-pv-ink">Editing disabled</h1>
        <p className="mt-2 text-sm text-pv-muted">
          This drop is {drop.status} and cannot be edited after activation lifecycle has started.
        </p>
        <p className="mt-1 text-xs text-pv-muted">Scheduled {formatDateTime(drop.scheduledAt)}</p>
        <Link href={routes.admin.drops} className={`${buttonClassName({ variant: "secondary" })} mt-4`}>
          Back to drops
        </Link>
      </section>
    );
  }

  const initialInput: AdminDropMutationInput = {
    name: drop.name,
    scheduledAt: drop.scheduledAt,
    lotteryEnabled: drop.lotteryEnabled,
    maxPacksPerUser: drop.maxPacksPerUser,
    tiers: drop.tiers.map((tier) => ({
      tier: tier.tier,
      price: tier.price,
      totalInventory: tier.totalInventory,
      composition: {
        setKeys: [...tier.composition.setKeys],
        includedRarities: [...tier.composition.includedRarities],
        explicitIncludeCardIds: [...tier.composition.explicitIncludeCardIds],
        explicitExcludeCardIds: [...tier.composition.explicitExcludeCardIds]
      }
    }))
  };

  const initialPreview = await previewAdminDropComposition(initialInput);

  return (
    <AdminDropEditor
      mode="edit"
      dropId={drop.id}
      initialStatus={drop.status}
      initialInput={initialInput}
      initialPreview={initialPreview}
    />
  );
}
