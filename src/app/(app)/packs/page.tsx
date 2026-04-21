import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PacksInventory } from "@/components/packs/packs-inventory";
import { routes } from "@/lib/routes";
import { useSession } from "@/server/auth/session";

function PacksInventoryFallback(): JSX.Element {
  return (
    <section className="rounded-2xl border border-pv-border bg-white p-6 shadow-sm">
      <p className="text-sm text-pv-muted">Loading pack inventory...</p>
    </section>
  );
}

export default async function PacksPage(): Promise<JSX.Element> {
  const session = await useSession();
  if (!session.isAuthenticated || !session.user) {
    redirect(routes.auth.login);
  }

  return (
    <section className="space-y-5">
      <header className="rounded-2xl border border-pv-border bg-white p-5 shadow-sm">
        <h1 id="my-packs-inventory-heading" className="text-3xl font-black text-pv-ink">
          My Packs
        </h1>
        <p className="mt-1 text-sm text-pv-muted">Track every pack you own and jump back into reveal anytime.</p>
      </header>

      <Suspense fallback={<PacksInventoryFallback />}>
        <PacksInventory />
      </Suspense>
    </section>
  );
}
