import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { unstable_noStore as noStore } from "next/cache";
import { buttonClassName } from "@/components/ui/button-styles";
import { StatTile } from "@/components/ui/stat-tile";
import { Chip, type ChipTone } from "@/components/ui/chip";
import { HeroBand } from "@/components/ui/hero-band";
import { RarityBadge } from "@/components/ui/rarity-badge";
import { CardImage } from "@/components/ui/card-image";
import { dropPackImagePath, dropPackImageDimensions } from "@/lib/drop-pack-image";
import { formatDateTime, formatMoneyCents, formatTierLabel } from "@/lib/format";
import { routes } from "@/lib/routes";
import { serverApiClient } from "@/lib/api-server";
import type { Drop, PackSummary, CollectionCard, Auction } from "@/lib/api-client";
import type { PackTier, RarityTier } from "@/lib/types";
import type { ServerSessionUser } from "@/server/auth/session";

type AuthedHomeProps = {
  user: ServerSessionUser;
};

/* ---------- shared helpers ------------------------------------------------ */

function TileCard({
  title,
  actionLabel,
  actionHref,
  children
}: {
  title: string;
  actionLabel?: string;
  actionHref?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-pv-h3">{title}</h2>
        {actionLabel && actionHref ? (
          <Link
            href={actionHref}
            className="text-[12px] font-semibold text-pv-muted hover:text-pv-gold"
          >
            {actionLabel} →
          </Link>
        ) : null}
      </div>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  );
}

function TileSkeleton(): JSX.Element {
  return (
    <div
      className="h-56 animate-pulse rounded-pv-lg border border-pv-line bg-pv-surface-2"
      aria-hidden="true"
    />
  );
}

function HeroSkeleton(): JSX.Element {
  return (
    <div
      className="aspect-[24/7] animate-pulse rounded-pv-xl border border-pv-line bg-pv-surface-2"
      aria-hidden="true"
    />
  );
}

/* ---------- duration helpers --------------------------------------------- */

function daysAgo(iso: string): number {
  const diff = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

function formatRelativeDaysAgo(iso: string | null | undefined): string {
  if (!iso) return "Just now";
  const d = daysAgo(iso);
  if (d === 0) return "today";
  if (d === 1) return "1d ago";
  return `${d}d ago`;
}

function formatRelativeCountdown(iso: string): string {
  const target = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(target - now, 0);
  const totalMinutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  const seconds = Math.floor((diff / 1000) % 60);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/* ---------- small tier thumb (44×44) used in Recent Packs row ----------- */

const DROP_TIER_IMAGE_SMALL: Record<PackTier, string> = {
  standard: "/images/drop/StandardDropPackImage.png",
  premium: "/images/drop/PremiumDropPackImage.png",
  elite: "/images/drop/EliteDropPackImage.png"
};

function TierThumb({ tier }: { tier: PackTier }): JSX.Element {
  return (
    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-pv-sm bg-[#0f0f13]">
      <Image
        src={DROP_TIER_IMAGE_SMALL[tier]}
        alt=""
        width={80}
        height={80}
        className="h-[80%] w-[80%] object-contain"
        aria-hidden="true"
      />
    </div>
  );
}

/* Collection Highlights uses the real CardImage primitive — no rarity-gradient helper needed. */

/* ---------- Next-drop hero band ------------------------------------------ */

function pickHeroDrop(drops: Drop[]): Drop | null {
  const upcoming = drops
    .filter((d) => d.status === "upcoming")
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0];
  if (upcoming) return upcoming;

  const active = drops
    .filter((d) => d.status === "active")
    .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())[0];
  return active ?? null;
}

async function NextDropHero(): Promise<JSX.Element> {
  const { drops } = await serverApiClient.listDrops(20);
  const hero = pickHeroDrop(drops);

  if (!hero) {
    return (
      <HeroBand aspect="24/7">
        <Chip tone="neutral">No drops right now</Chip>
        <h2 className="mt-2.5 text-pv-h2">Stay tuned</h2>
        <p className="mt-1.5 max-w-[500px] text-[13px] text-pv-muted">
          The next drop will appear here as soon as it's scheduled.
        </p>
      </HeroBand>
    );
  }

  const tiers = hero.tiers.map((t) => t.tier);
  const imagePath = dropPackImagePath(tiers);
  const imageDims = dropPackImageDimensions(tiers);
  const heroTone: ChipTone = hero.status === "active" ? "live" : "upcoming";
  const heroTitle = `Drop ${hero.id.slice(0, 8)}`;
  const heroSub =
    hero.status === "active"
      ? "Live now · Pick a tier and rip your pack."
      : `Scheduled ${formatDateTime(hero.scheduledAt)}.`;
  const heroCountdown =
    hero.status === "upcoming"
      ? `Opens in ${formatRelativeCountdown(hero.scheduledAt)}`
      : "Live now";

  return (
    <HeroBand
      aspect="24/7"
      preview={
        <Image
          src={imagePath}
          alt=""
          width={imageDims.width}
          height={imageDims.height}
          className="h-auto w-full object-contain drop-shadow-[0_30px_60px_rgba(0,0,0,0.55)]"
          aria-hidden="true"
          priority
        />
      }
    >
      <Chip tone={heroTone} pulse={hero.status === "active"}>
        {hero.status === "active" ? "Live now" : heroCountdown}
      </Chip>
      <h2 className="mt-2.5 text-pv-h2">{heroTitle}</h2>
      <p className="mt-1.5 max-w-[500px] text-[13px] text-pv-muted">{heroSub}</p>
      <div className="mt-3.5 flex items-center gap-3">
        <Link
          href={routes.drops.detail(hero.id)}
          className={buttonClassName({ variant: "primary" })}
        >
          {hero.status === "active" ? "Rip a pack" : "View drop"}
        </Link>
        <Link href={routes.drops.index} className={buttonClassName({ variant: "ghost" })}>
          All drops →
        </Link>
      </div>
    </HeroBand>
  );
}

/* ---------- Recent Packs (left half) ------------------------------------ */

async function RecentPacksTile({ userId }: { userId: string }): Promise<JSX.Element> {
  const { packs } = await serverApiClient.listPacks(userId, 5);

  return (
    <TileCard title="Recent packs" actionLabel="View all" actionHref={routes.packs.index}>
      {packs.length === 0 ? (
        <p className="text-[13px] text-pv-muted">No packs yet. Join the next drop.</p>
      ) : (
        packs.slice(0, 4).map((pack) => <RecentPackRow key={pack.id} pack={pack} />)
      )}
    </TileCard>
  );
}

function RecentPackRow({ pack }: { pack: PackSummary }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <TierThumb tier={pack.tier} />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-bold text-pv-text">
            {formatTierLabel(pack.tier)} Pack
          </p>
          <p className="mt-0.5 truncate text-[12px] text-pv-muted">
            {pack.dropName} · {formatRelativeDaysAgo(pack.purchasedAt)}
          </p>
        </div>
      </div>
      <Link
        href={routes.packs.reveal(pack.id)}
        className={buttonClassName({
          variant: pack.opened ? "ghost" : "secondary",
          size: "sm"
        })}
      >
        {pack.opened ? "Review" : "Open"}
      </Link>
    </div>
  );
}

/* ---------- Active Bids (right half) ------------------------------------ */

async function ActiveBidsTile({ userId }: { userId: string }): Promise<JSX.Element> {
  const { auctions } = await serverApiClient.listAuctions({ page: 1, limit: 24 });
  const myLeading = auctions.filter((a) => a.currentBidderId === userId).slice(0, 3);

  return (
    <TileCard title="Active bids" actionLabel="View all" actionHref={routes.auctions.index}>
      {myLeading.length === 0 ? (
        <p className="text-[13px] text-pv-muted">No leading bids right now.</p>
      ) : (
        myLeading.map((auction) => <ActiveBidRow key={auction.id} auction={auction} />)
      )}
    </TileCard>
  );
}

function ActiveBidRow({ auction }: { auction: Auction }): JSX.Element {
  const currentBid = auction.currentBid ?? auction.startingBid;
  return (
    <Link
      href={routes.auctions.detail(auction.id)}
      className="flex items-center justify-between gap-2 rounded-pv-sm px-1 py-1 transition hover:bg-pv-surface-3"
    >
      <div className="min-w-0">
        <p className="truncate text-[13px] font-bold text-pv-text">
          {auction.card.pokemonCard.name}
        </p>
        <p className="mt-0.5 truncate text-[12px]">
          <span className="text-pv-good">You lead</span>
          <span className="text-pv-muted">
            {" "}
            · ends in {formatRelativeCountdown(auction.endsAt)}
          </span>
        </p>
      </div>
      <span className="font-extrabold tabular-nums text-pv-gold">
        {formatMoneyCents(currentBid)}
      </span>
    </Link>
  );
}

/* ---------- Collection Highlights section ------------------------------- */

async function CollectionHighlightsSection({ userId }: { userId: string }): Promise<JSX.Element> {
  const { cards } = await serverApiClient.listCollection(userId, {
    page: 1,
    limit: 4,
    sort: "value_desc"
  });

  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 className="text-pv-h2">Collection highlights</h2>
        <Link
          href={routes.collection.index}
          className="text-[12px] font-semibold text-pv-muted hover:text-pv-gold"
        >
          Open collection →
        </Link>
      </div>

      {cards.length === 0 ? (
        <p className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-4 text-[13px] text-pv-muted">
          No cards in your collection yet.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {cards.map((card) => (
            <CollectionHighlightCard key={card.id} card={card} />
          ))}
        </div>
      )}
    </section>
  );
}

function CollectionHighlightCard({ card }: { card: CollectionCard }): JSX.Element {
  const rarity = card.pokemonCard.rarityTier;
  return (
    <Link
      href={routes.collection.index}
      className="group flex flex-col gap-2.5 rounded-pv-lg border border-pv-line bg-pv-surface-2 p-3.5 transition hover:-translate-y-0.5 hover:border-pv-line-strong"
    >
      {/* Rarity badge above the card art so it never overlaps */}
      <div className="flex flex-col items-center gap-1.5">
        <div className="self-start">
          <RarityBadge rarity={rarity} compact />
        </div>
        <CardImage
          src={card.pokemonCard.imageUrl}
          hiresSrc={card.pokemonCard.imageUrlHires}
          alt={card.pokemonCard.name}
          size="md"
          rarityTier={rarity}
        />
      </div>

      <div>
        <p className="truncate text-[13px] font-bold text-pv-text">{card.pokemonCard.name}</p>
        <p className="mt-0.5 flex items-center justify-between gap-2 text-[12px] text-pv-muted">
          <span className="truncate">{card.pokemonCard.setName}</span>
          <span className="font-extrabold tabular-nums text-pv-text">
            {formatMoneyCents(card.currentPrice)}
          </span>
        </p>
      </div>
    </Link>
  );
}

/* ---------- Unopened packs count (for stats row) ------------------------ */

async function resolveUnopenedStat(userId: string): Promise<{
  count: number;
  oldestLabel: string;
}> {
  const { packs } = await serverApiClient.listPacks(userId, 50);
  const unopened = packs.filter((p) => !p.opened);
  if (unopened.length === 0) return { count: 0, oldestLabel: "None" };
  const oldest = unopened.reduce(
    (acc, p) => (new Date(p.purchasedAt).getTime() < new Date(acc.purchasedAt).getTime() ? p : acc),
    unopened[0]
  );
  return {
    count: unopened.length,
    oldestLabel: `Oldest: ${formatRelativeDaysAgo(oldest.purchasedAt)}`
  };
}

/* ---------- Active bid count (for stats row) ---------------------------- */

async function resolveActiveBidCount(userId: string): Promise<number> {
  const { auctions } = await serverApiClient.listAuctions({ page: 1, limit: 24 });
  return auctions.filter((a) => a.currentBidderId === userId).length;
}

/* ---------- Portfolio value (for stats row) ----------------------------- */

async function resolvePortfolio(
  userId: string
): Promise<{ value: number; cardCount: number }> {
  const summary = await serverApiClient.getCollectionPortfolioSummary(userId);
  return { value: summary.totalValueCents, cardCount: summary.cardCount };
}

/* ============================================================================
 * AuthedHome — top-level layout matches demo/home.html:
 *   Header  →  4-stat strip  →  Next-drop hero  →  Two-col (Recent + Bids)
 *           →  Collection highlights section
 * =========================================================================== */

export async function AuthedHome({ user }: AuthedHomeProps): Promise<JSX.Element> {
  noStore();

  const [balance, unopenedStat, bidCount, portfolio] = await Promise.all([
    serverApiClient.getBalance(user.id),
    resolveUnopenedStat(user.id),
    resolveActiveBidCount(user.id),
    resolvePortfolio(user.id)
  ]);

  return (
    <div className="space-y-5">
      {/* HEADER */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-[0.05em] text-pv-muted">
            Welcome back
          </p>
          <h1 className="mt-1 text-pv-h1">@{user.username}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href={routes.drops.index} className={buttonClassName({ variant: "primary" })}>
            Browse drops
          </Link>
          <Link
            href={routes.collection.index}
            className={buttonClassName({ variant: "secondary" })}
          >
            Open collection
          </Link>
        </div>
      </header>

      {/* STATS ROW — 4 tiles, demo order verbatim */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Available"
          value={formatMoneyCents(balance.available)}
          delta="Wallet"
          tone="muted"
        />
        <StatTile
          label="Held in auctions"
          value={formatMoneyCents(balance.held)}
          delta={`${bidCount} active bid${bidCount === 1 ? "" : "s"}`}
          tone="muted"
        />
        <StatTile
          label="Portfolio value"
          value={formatMoneyCents(portfolio.value)}
          delta={`${portfolio.cardCount} card${portfolio.cardCount === 1 ? "" : "s"}`}
          tone="good"
        />
        <StatTile
          label="Unopened packs"
          value={<span className="text-pv-gold">{unopenedStat.count}</span>}
          delta={unopenedStat.oldestLabel}
          tone="gold"
        />
      </section>

      {/* NEXT-DROP HERO */}
      <Suspense fallback={<HeroSkeleton />}>
        <NextDropHero />
      </Suspense>

      {/* TWO-COL: Recent packs + Active bids */}
      <section className="grid gap-4 md:grid-cols-2">
        <Suspense fallback={<TileSkeleton />}>
          <RecentPacksTile userId={user.id} />
        </Suspense>
        <Suspense fallback={<TileSkeleton />}>
          <ActiveBidsTile userId={user.id} />
        </Suspense>
      </section>

      {/* COLLECTION HIGHLIGHTS */}
      <Suspense
        fallback={
          <div className="space-y-2" aria-hidden="true">
            <div className="h-6 w-48 animate-pulse rounded bg-pv-surface-2" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="aspect-[5/7] animate-pulse rounded-pv-lg bg-pv-surface-2" />
              ))}
            </div>
          </div>
        }
      >
        <CollectionHighlightsSection userId={user.id} />
      </Suspense>
    </div>
  );
}
