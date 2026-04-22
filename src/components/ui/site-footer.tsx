import Link from "next/link";
import { LegalLinks } from "@/components/ui/legal-links";
import { routes } from "@/lib/routes";

export function SiteFooter(): JSX.Element {
  return (
    <footer role="contentinfo" className="border-t border-pv-line bg-pv-surface">
      <div className="mx-auto grid w-full max-w-[1400px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-3 lg:px-7">
        <section>
          <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-pv-muted">Product</h2>
          <nav aria-label="Product links" className="mt-3 flex flex-col gap-2 text-sm">
            <Link href={routes.drops.index} className="text-pv-text hover:text-pv-gold">
              Drops
            </Link>
            <Link href={routes.marketplace.index} className="text-pv-text hover:text-pv-gold">
              Marketplace
            </Link>
            <Link href={routes.packs.index} className="text-pv-text hover:text-pv-gold">
              My Packs
            </Link>
          </nav>
        </section>

        <section>
          <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-pv-muted">Company</h2>
          <nav aria-label="Company links" className="mt-3 flex flex-col gap-2 text-sm">
            <Link href={routes.legal.about} className="text-pv-text hover:text-pv-gold">
              About PullVault
            </Link>
            <Link href={routes.legal.fairnessExplainer} className="text-pv-text hover:text-pv-gold">
              Provable Fairness
            </Link>
          </nav>
        </section>

        <section>
          <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-pv-muted">Legal</h2>
          <LegalLinks className="mt-3" />
        </section>
      </div>

      <div className="border-t border-pv-line px-4 py-3 sm:px-6 lg:px-7">
        <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-2 text-[12px] text-pv-muted">
          <p>© {new Date().getFullYear()} PullVault. Placeholder copy for development use.</p>
          <Link
            href="https://www.anthropic.com/claude"
            target="_blank"
            rel="noreferrer"
            className="hover:text-pv-text"
          >
            PullVault
          </Link>
        </div>
      </div>
    </footer>
  );
}
