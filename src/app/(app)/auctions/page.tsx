"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AuctionListingCard } from "@/components/auctions/auction-listing-card";
import { Button } from "@/components/ui/button";
import { buttonClassName } from "@/components/ui/button-styles";
import { CardGrid } from "@/components/ui/card-grid";
import { LoadingCardGrid } from "@/components/ui/loading-card-grid";
import { PaginationFooter } from "@/components/ui/pagination-footer";
import { useAuctions, type AuctionBrowseSort } from "@/hooks/use-auctions";
import { useAuth } from "@/hooks/use-auth";
import { routes } from "@/lib/routes";

const SORT_OPTIONS: Array<{ label: string; value: AuctionBrowseSort }> = [
  { label: "Ending Soonest", value: "ending_soonest" },
  { label: "Newest", value: "newest" },
  { label: "Highest Bid", value: "highest_bid" }
];

export default function AuctionsPage(): JSX.Element {
  const { user } = useAuth();
  const [sort, setSort] = useState<AuctionBrowseSort>("ending_soonest");
  const auctions = useAuctions({ sort });

  const itemLabel = useMemo(() => {
    if (auctions.auctions.length === 1) {
      return "1 active auction loaded";
    }

    return `${auctions.auctions.length} loaded${auctions.total ? ` of ${auctions.total}` : ""}`;
  }, [auctions.auctions.length, auctions.total]);

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-slate-950">Auctions</h1>
          <p className="mt-1 text-sm text-slate-600">
            Browse live auction rooms with anti-snipe extension and real-time bid updates.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void auctions.refresh()}>
          Refresh
        </Button>
      </div>

      <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-2">
        <label className="text-sm font-semibold text-slate-700">
          Sort
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as AuctionBrowseSort)}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-500"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-end">
          <p className="text-sm font-semibold text-slate-600">{itemLabel}</p>
        </div>
      </section>

      {auctions.loading ? (
        <div className="space-y-3">
          <p className="text-sm font-medium text-slate-600">Loading auctions...</p>
          <LoadingCardGrid cards={6} />
        </div>
      ) : null}
      {auctions.error ? <p className="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{auctions.error}</p> : null}

      {!auctions.loading && !auctions.error && auctions.auctions.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          <p className="font-semibold text-slate-900">No active auctions right now.</p>
          <p className="mt-1">Start an auction from your collection to bootstrap activity.</p>
          <Link href={routes.collection.index} className={`${buttonClassName({ variant: "primary", size: "sm" })} mt-3`}>
            Open Collection
          </Link>
        </div>
      ) : null}

      <CardGrid
        items={auctions.auctions}
        ariaLabel="Auctions"
        itemKey={(auction) => auction.id}
        renderItem={(auction) => <AuctionListingCard auction={auction} currentUserId={user?.id ?? null} />}
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
