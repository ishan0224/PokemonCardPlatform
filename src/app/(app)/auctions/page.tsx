"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AuctionListingCard } from "@/components/auctions/auction-listing-card";
import { Button, buttonClassName } from "@/components/ui/button";
import { CardGrid } from "@/components/ui/card-grid";
import { LoadingCardGrid } from "@/components/ui/loading-card-grid";
import { PaginationFooter } from "@/components/ui/pagination-footer";
import { useAuctions, type AuctionBrowseSort } from "@/hooks/use-auctions";
import { useAuth } from "@/hooks/use-auth";
import { routes } from "@/lib/routes";

const SORT_OPTIONS: Array<{ label: string; value: AuctionBrowseSort }> = [
  { label: "Ending soonest", value: "ending_soonest" },
  { label: "Newest", value: "newest" },
  { label: "Highest bid", value: "highest_bid" }
];

const INPUT_CLASS =
  "w-full rounded-pv-sm border border-pv-line bg-pv-surface-3 px-3 py-2 text-[13px] font-medium text-pv-text outline-none transition focus:border-pv-gold focus:ring-2 focus:ring-pv-gold/25";

export default function AuctionsPage(): JSX.Element {
  const { user } = useAuth();
  const [sort, setSort] = useState<AuctionBrowseSort>("ending_soonest");
  const auctions = useAuctions({ sort });

  const resultLabel = useMemo(() => {
    if (auctions.auctions.length === 1) return "1 active auction";
    return `${auctions.auctions.length} loaded${auctions.total ? ` of ${auctions.total}` : ""}`;
  }, [auctions.auctions.length, auctions.total]);

  const endingSoonCount = useMemo(() => {
    const now = Date.now();
    return auctions.auctions.filter(
      (a) => new Date(a.endsAt).getTime() - now < 60 * 60 * 1000
    ).length;
  }, [auctions.auctions]);

  return (
    <section className="space-y-5">
      {/* HEADER */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-pv-h1">Auctions</h1>
          <p className="mt-1 text-[13px] text-pv-muted">
            Real-time bidding · soft-close extension · wash-trade protected.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-pv-muted before:block before:h-1.5 before:w-1.5 before:rounded-full before:bg-pv-good">
            {auctions.auctions.length} live · {endingSoonCount} ending soon
          </span>
          <Button variant="secondary" size="sm" onClick={() => void auctions.refresh()}>
            Refresh
          </Button>
        </div>
      </header>

      {/* FILTER RAIL */}
      <section className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="text-[12px] text-pv-muted" aria-live="polite">
            {resultLabel}
          </p>
          <label className="flex flex-col gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-pv-muted">
            Sort
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as AuctionBrowseSort)}
              className={`${INPUT_CLASS} min-w-[180px]`}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {/* LOADING / ERROR / EMPTY */}
      {auctions.loading ? (
        <div className="space-y-3">
          <p className="text-[13px] font-medium text-pv-muted">Loading auctions…</p>
          <LoadingCardGrid cards={6} />
        </div>
      ) : null}
      {auctions.error ? (
        <p
          role="alert"
          className="rounded-pv-sm border border-pv-accent/30 bg-[rgba(239,68,68,0.08)] p-3 text-[13px] font-medium text-[#fca5a5]"
        >
          {auctions.error}
        </p>
      ) : null}

      {!auctions.loading && !auctions.error && auctions.auctions.length === 0 ? (
        <div className="rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5 text-[13px] text-pv-muted">
          <p className="font-bold text-pv-text">No active auctions right now.</p>
          <p className="mt-1">Start an auction from your collection to bootstrap activity.</p>
          <Link
            href={routes.collection.index}
            className={`${buttonClassName({ variant: "primary", size: "sm" })} mt-3`}
          >
            Open collection
          </Link>
        </div>
      ) : null}

      {/* GRID */}
      <CardGrid
        items={auctions.auctions}
        ariaLabel="Auctions"
        itemKey={(auction) => auction.id}
        renderItem={(auction) => (
          <AuctionListingCard auction={auction} currentUserId={user?.id ?? null} />
        )}
      />

      <PaginationFooter
        hasMore={auctions.hasMore}
        loading={auctions.loadingMore}
        onLoadMore={() => {
          void auctions.loadMore();
        }}
        loadedCount={auctions.auctions.length}
        totalCount={auctions.total}
      />
    </section>
  );
}
