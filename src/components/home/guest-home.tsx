import Image from "next/image";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { buttonClassName } from "@/components/ui/button-styles";
import { formatDateTime, formatMoneyCents, formatTierLabel } from "@/lib/format";
import { routes } from "@/lib/routes";
import { serverApiClient } from "@/lib/api-server";
import type { Drop } from "@/lib/api-client";

const getGuestHomeDrops = unstable_cache(
  async (): Promise<Drop[]> => {
    const { drops } = await serverApiClient.listDrops(6);
    return drops.filter((drop) => drop.status === "active" || drop.status === "upcoming");
  },
  ["home:guest:drops"],
  { revalidate: 30 }
);

export async function GuestHome(): Promise<JSX.Element> {
  const drops = await getGuestHomeDrops();

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl border border-pv-border bg-pv-ink text-white">
        <Image
          src="/images/home-guest-hero.svg"
          alt="PullVault hero artwork"
          fill
          priority
          sizes="(min-width: 1024px) 1200px, 100vw"
          className="object-cover"
        />
        <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.1fr_0.9fr] lg:p-10">
          <div>
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
              <Link href={routes.drops.index} className={buttonClassName({ variant: "secondary" })}>
                Browse drops
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-white/20 bg-black/20 p-5 backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-300">How it works</p>
            <ol className="mt-3 space-y-2 text-sm text-slate-100">
              <li>1. Pick a live drop tier.</li>
              <li>2. Buy and open your pack.</li>
              <li>3. Reveal card slots one-by-one.</li>
              <li>4. List or auction from your collection.</li>
            </ol>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-pv-border bg-white p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-black text-pv-ink">Live and upcoming drops</h2>
          <Link href={routes.drops.index} className="text-sm font-semibold text-pv-accent hover:text-pv-accent-strong">
            View all
          </Link>
        </div>

        {drops.length === 0 ? (
          <p className="mt-4 text-sm text-pv-muted">No active or upcoming drops right now.</p>
        ) : (
          <div className="mt-4 grid gap-3 lg:grid-cols-3" aria-live="polite">
            {drops.slice(0, 3).map((drop) => (
              <article key={drop.id} className="rounded-xl border border-pv-border bg-pv-parchment-soft p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-pv-muted">{drop.status}</p>
                <p className="mt-1 text-sm font-bold text-pv-ink">Drop {drop.id.slice(0, 8)}</p>
                <p className="mt-1 text-xs text-pv-muted">{formatDateTime(drop.scheduledAt)}</p>
                <ul className="mt-3 space-y-1 text-xs text-pv-muted">
                  {drop.tiers.slice(0, 2).map((tier) => (
                    <li key={tier.dropPackId} className="flex items-center justify-between gap-2">
                      <span>{formatTierLabel(tier.tier)}</span>
                      <span className="font-semibold text-pv-ink">{formatMoneyCents(tier.price)}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )}
      </section>

      <footer className="flex flex-wrap items-center gap-4 border-t border-pv-border pt-4 text-sm text-pv-muted">
        <span>Terms</span>
        <span>Privacy</span>
        <Link
          href={routes.fairness.publicVerifyIndex}
          className="font-semibold text-pv-accent hover:text-pv-accent-strong"
        >
          Fairness
        </Link>
      </footer>
    </div>
  );
}
