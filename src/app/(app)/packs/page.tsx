import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PacksInventory } from "@/components/packs/packs-inventory";
import { StatTile } from "@/components/ui/stat-tile";
import { routes } from "@/lib/routes";
import { serverApiClient } from "@/lib/api-server";
import { useSession } from "@/server/auth/session";

function PacksInventoryFallback(): JSX.Element {
  return (
    <section
      className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-6"
      role="status"
      aria-live="polite"
    >
      <p className="text-[13px] text-pv-muted">Loading pack inventory…</p>
    </section>
  );
}

async function PacksHeaderStats({ userId }: { userId: string }): Promise<JSX.Element> {
  const { packs } = await serverApiClient.listPacks(userId, 200);
  const opened = packs.filter((p) => p.opened).length;
  const unopened = packs.length - opened;

  return (
    <div className="flex items-center gap-3">
      <StatTile
        label="Unopened"
        value={<span className="text-pv-gold">{unopened}</span>}
        delta={unopened === 0 ? "All caught up" : "Open to reveal"}
        tone="gold"
        valueClassName="text-[18px]"
      />
      <StatTile
        label="Opened"
        value={opened}
        delta={opened === 0 ? "None yet" : "Reveal archive"}
        tone="muted"
        valueClassName="text-[18px]"
      />
    </div>
  );
}

function PacksHeaderStatsFallback(): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <div className="h-[72px] w-[140px] animate-pulse rounded-pv border border-pv-line bg-pv-surface-2" />
      <div className="h-[72px] w-[140px] animate-pulse rounded-pv border border-pv-line bg-pv-surface-2" />
    </div>
  );
}

export default async function PacksPage(): Promise<JSX.Element> {
  const session = await useSession();
  if (!session.isAuthenticated || !session.user) {
    redirect(routes.auth.login);
  }

  return (
    <section className="space-y-5">
      {/* HEADER */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 id="my-packs-inventory-heading" className="text-pv-h1">
            My Packs
          </h1>
          <p className="mt-1 text-[13px] text-pv-muted">
            Unopened first. Every pack links straight to reveal.
          </p>
        </div>
        <Suspense fallback={<PacksHeaderStatsFallback />}>
          <PacksHeaderStats userId={session.user.id} />
        </Suspense>
      </header>

      {/* INVENTORY */}
      <Suspense fallback={<PacksInventoryFallback />}>
        <PacksInventory />
      </Suspense>
    </section>
  );
}
