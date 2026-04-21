import Link from "next/link";
import { LegalLinks } from "@/components/ui/legal-links";
import { routes } from "@/lib/routes";

export function SiteFooter(): JSX.Element {
  return (
    <footer role="contentinfo" className="border-t border-pv-border bg-pv-parchment-soft/40">
      <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-3 lg:px-8">
        <section>
          <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-pv-muted">Product</h2>
          <nav aria-label="Product links" className="mt-3 flex flex-col gap-2 text-sm">
            <Link href={routes.drops.index} className="text-pv-ink hover:text-pv-accent">
              Drops
            </Link>
            <Link href={routes.marketplace.index} className="text-pv-ink hover:text-pv-accent">
              Marketplace
            </Link>
            <Link href={routes.packs.index} className="text-pv-ink hover:text-pv-accent">
              My Packs
            </Link>
          </nav>
        </section>

        <section>
          <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-pv-muted">Company</h2>
          <nav aria-label="Company links" className="mt-3 flex flex-col gap-2 text-sm">
            <Link href={routes.legal.about} className="text-pv-ink hover:text-pv-accent">
              About PullVault
            </Link>
            <Link href={routes.legal.fairnessExplainer} className="text-pv-ink hover:text-pv-accent">
              Provable Fairness
            </Link>
          </nav>
        </section>

        <section>
          <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-pv-muted">Legal</h2>
          <LegalLinks className="mt-3" />
        </section>
      </div>

      <div className="border-t border-pv-border/70 px-4 py-3 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-2 text-xs text-pv-muted">
          <p>© {new Date().getFullYear()} PullVault. Placeholder copy for development use.</p>
          <Link href="https://www.anthropic.com/claude" target="_blank" rel="noreferrer" className="hover:text-pv-ink">
            Made with Claude
          </Link>
        </div>
      </div>
    </footer>
  );
}
