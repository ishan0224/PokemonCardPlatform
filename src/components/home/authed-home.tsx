import Link from "next/link";
import { Suspense } from "react";
import { unstable_noStore as noStore } from "next/cache";
import { buttonClassName } from "@/components/ui/button-styles";
import { formatDateTime, formatMoneyCents, formatTierLabel } from "@/lib/format";
import { routes } from "@/lib/routes";
import { serverApiClient } from "@/lib/api-server";
import type { ServerSessionUser } from "@/server/auth/session";

type AuthedHomeProps = {
  user: ServerSessionUser;
};

type TileProps = {
  title: string;
  children: React.ReactNode;
  actionLabel?: string;
  actionHref?: string;
};

function Tile({ title, children, actionLabel, actionHref }: TileProps): JSX.Element {
  return (
    <section className="h-full rounded-2xl border border-pv-border bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-black text-pv-ink">{title}</h2>
        {actionLabel && actionHref ? (
          <Link href={actionHref} className="text-xs font-semibold text-pv-accent hover:text-pv-accent-strong">
            {actionLabel}
          </Link>
        ) : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function TileSkeleton(): JSX.Element {
  return <div className="h-52 animate-pulse rounded-2xl border border-pv-border bg-pv-parchment-soft" aria-hidden="true" />;
}

function formatRelativeCountdown(isoDate: string): string {
  const target = new Date(isoDate).getTime();
  const now = Date.now();
  const diff = Math.max(target - now, 0);

  const totalMinutes = Math.floor(diff / (1000 * 60));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  return `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`;
}

async function ActiveBidsTile({ userId }: { userId: string }): Promise<JSX.Element> {
  const { auctions } = await serverApiClient.listAuctions({ page: 1, limit: 24 });
  const myActiveBids = auctions.filter((auction) => auction.currentBidderId === userId).slice(0, 3);

  return (
    <Tile title="Active Bids" actionLabel="Open auctions" actionHref={routes.auctions.index}>
      {myActiveBids.length === 0 ? (
        <p className="text-sm text-pv-muted">No leading bids right now.</p>
      ) : (
        <ul className="space-y-2 text-sm" aria-live="polite">
          {myActiveBids.map((auction) => (
            <li key={auction.id} className="rounded-lg border border-pv-border bg-pv-parchment-soft px-3 py-2">
              <p className="font-semibold text-pv-ink">{auction.card.pokemonCard.name}</p>
              <p className="mt-1 text-xs text-pv-muted">
                Leading at {formatMoneyCents(auction.currentBid ?? auction.startingBid)} · Ends {formatDateTime(auction.endsAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}

async function RecentPacksTile({ userId }: { userId: string }): Promise<JSX.Element> {
  const { packs } = await serverApiClient.listPacks(userId, 4);

  return (
    <Tile title="Recent Packs" actionLabel="Browse drops" actionHref={routes.drops.index}>
      {packs.length === 0 ? (
        <p className="text-sm text-pv-muted">No packs yet. Join the next drop.</p>
      ) : (
        <ul className="space-y-2 text-sm" aria-live="polite">
          {packs.map((pack) => (
            <li key={pack.id} className="rounded-lg border border-pv-border bg-pv-parchment-soft px-3 py-2">
              <p className="font-semibold text-pv-ink">
                {formatTierLabel(pack.tier)} · {pack.opened ? "Opened" : "Sealed"}
              </p>
              <p className="mt-1 text-xs text-pv-muted">
                Paid {formatMoneyCents(pack.pricePaid)} · {formatDateTime(pack.purchasedAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}

async function CollectionHighlightsTile({ userId }: { userId: string }): Promise<JSX.Element> {
  const { cards } = await serverApiClient.listCollection(userId, {
    page: 1,
    limit: 4,
    sort: "value_desc"
  });

  return (
    <Tile title="Collection Highlights" actionLabel="Open collection" actionHref={routes.collection.index}>
      {cards.length === 0 ? (
        <p className="text-sm text-pv-muted">No cards in your collection yet.</p>
      ) : (
        <ul className="space-y-2 text-sm" aria-live="polite">
          {cards.map((card) => (
            <li key={card.id} className="rounded-lg border border-pv-border bg-pv-parchment-soft px-3 py-2">
              <p className="font-semibold text-pv-ink">{card.pokemonCard.name}</p>
              <p className="mt-1 text-xs text-pv-muted">
                {card.pokemonCard.rarityTier} · Market {formatMoneyCents(card.currentPrice)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}

async function NextDropTile(): Promise<JSX.Element> {
  const { drops } = await serverApiClient.listDrops(10);
  const nextUpcoming = drops
    .filter((drop) => drop.status === "upcoming")
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0];

  return (
    <Tile title="Next Drop Countdown" actionLabel="Open drops" actionHref={routes.drops.index}>
      {!nextUpcoming ? (
        <p className="text-sm text-pv-muted">No upcoming drop scheduled yet.</p>
      ) : (
        <div className="rounded-lg border border-pv-border bg-pv-parchment-soft px-3 py-3">
          <p className="text-sm font-semibold text-pv-ink">Drop {nextUpcoming.id.slice(0, 8)}</p>
          <p className="mt-1 text-xs text-pv-muted">Starts in {formatRelativeCountdown(nextUpcoming.scheduledAt)}</p>
          <p className="mt-1 text-xs text-pv-muted">{formatDateTime(nextUpcoming.scheduledAt)}</p>
        </div>
      )}
    </Tile>
  );
}

export async function AuthedHome({ user }: AuthedHomeProps): Promise<JSX.Element> {
  noStore();

  const balance = await serverApiClient.getBalance(user.id);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-pv-border bg-white p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-pv-muted">Dashboard</p>
        <h1 className="mt-2 text-3xl font-black text-pv-ink sm:text-4xl">Welcome back, {user.username}</h1>
        <p className="mt-2 max-w-2xl text-sm text-pv-muted">
          Monitor your available balance, track live bids, and jump into the next drop.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <article className="rounded-xl border border-pv-border bg-pv-parchment-soft p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-pv-muted">Available</p>
            <p className="mt-1 text-2xl font-black text-pv-ink">{formatMoneyCents(balance.available)}</p>
          </article>
          <article className="rounded-xl border border-pv-border bg-pv-parchment-soft p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-pv-muted">Held</p>
            <p className="mt-1 text-2xl font-black text-pv-ink">{formatMoneyCents(balance.held)}</p>
          </article>
          <article className="rounded-xl border border-pv-border bg-pv-parchment-soft p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-pv-muted">Total</p>
            <p className="mt-1 text-2xl font-black text-pv-ink">{formatMoneyCents(balance.total)}</p>
          </article>
        </div>

        <div className="mt-5">
          <Link href={routes.drops.index} className={buttonClassName({ variant: "primary" })}>
            Enter live drops
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Suspense fallback={<TileSkeleton />}>
          <ActiveBidsTile userId={user.id} />
        </Suspense>
        <Suspense fallback={<TileSkeleton />}>
          <RecentPacksTile userId={user.id} />
        </Suspense>
        <Suspense fallback={<TileSkeleton />}>
          <CollectionHighlightsTile userId={user.id} />
        </Suspense>
        <Suspense fallback={<TileSkeleton />}>
          <NextDropTile />
        </Suspense>
      </section>
    </div>
  );
}
