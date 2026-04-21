import Link from "next/link";
import { buttonClassName } from "@/components/ui/button-styles";
import { routes } from "@/lib/routes";

export default function FairnessVerifyIndexPage(): JSX.Element {
  return (
    <section className="rounded-2xl border border-pv-border bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-black text-pv-ink">Verification Hub</h1>
      <p className="mt-2 text-sm text-pv-muted">
        Phase 6 adds recent-pack browsing. For now, open verification from an individual pack URL.
      </p>
      <div className="mt-4">
        <Link href={routes.drops.index} className={buttonClassName({ variant: "secondary" })}>
          Back to Drops
        </Link>
      </div>
    </section>
  );
}
