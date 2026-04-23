import Image from "next/image";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { GuestMarketplaceGrid } from "@/components/home/guest-marketplace-grid";
import { buttonClassName } from "@/components/ui/button-styles";
import { routes } from "@/lib/routes";
import { serverApiClient } from "@/lib/api-server";
import type { MarketplaceListing } from "@/lib/api-client";

const getGuestHomeMarketplace = unstable_cache(
  async (): Promise<MarketplaceListing[]> => {
    const { listings } = await serverApiClient.listMarketplaceListings({
      sort: "newest",
      page: 1,
      limit: 5
    });
    return listings;
  },
  ["home:guest:marketplace"],
  { revalidate: 30 }
);

export async function GuestHome(): Promise<JSX.Element> {
  const listings = await getGuestHomeMarketplace();

  return (
    <div className="space-y-8">
      <section className="relative aspect-[21/9] overflow-hidden rounded-3xl border border-pv-border bg-pv-ink text-white">
        <Image
          src="/images/home-guest-hero.png"
          alt="PullVault hero artwork"
          fill
          priority
          sizes="(min-width: 1024px) 1200px, 100vw"
          className="object-cover"
        />
        <div className="relative p-6 sm:p-8 lg:p-10">
          <p className="inline-flex rounded-full bg-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em]">
            Live card drops
          </p>
          <h1 className="mt-4 max-w-xl text-4xl font-black leading-tight sm:text-5xl">
            Collect, reveal, and trade cards in real time.
          </h1>
          <p className="mt-4 max-w-lg text-sm text-slate-200 sm:text-base">
            Join upcoming drops, secure packs before sellout, and reveal every slot with market-value feedback.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href={routes.auth.register} className={buttonClassName({ variant: "primary" })}>
              Create account
            </Link>
            <Link href={routes.marketplace.index} className={buttonClassName({ variant: "secondary" })}>
              Browse marketplace
            </Link>
          </div>
        </div>
      </section>

      <section className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-pv-h2">Marketplace · Live listings</h2>
            <p className="mt-1 text-[13px] text-pv-muted">
              Cards other collectors are selling right now. Log in to buy instantly.
            </p>
          </div>
          <Link
            href={routes.marketplace.index}
            className="text-[13px] font-semibold text-pv-gold hover:text-pv-text"
          >
            View all →
          </Link>
        </div>

        <div className="mt-5">
          {listings.length === 0 ? (
            <p className="text-[13px] text-pv-muted">No listings are live right now. Check back soon.</p>
          ) : (
            <GuestMarketplaceGrid listings={listings} />
          )}
        </div>
      </section>

      <footer className="flex flex-wrap items-center gap-4 border-t border-pv-line pt-4 text-sm text-pv-muted">
        <Link href={routes.legal.terms} className="hover:text-pv-text">Terms</Link>
        <Link href={routes.legal.privacy} className="hover:text-pv-text">Privacy</Link>
        <Link
          href={routes.fairness.publicVerifyIndex}
          className="font-semibold text-pv-gold hover:text-pv-text"
        >
          Fairness
        </Link>
      </footer>
    </div>
  );
}
