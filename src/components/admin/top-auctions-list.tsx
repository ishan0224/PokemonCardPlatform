import type { TopAuction } from "@/lib/types";
import { formatDateTime, formatMoneyCents } from "@/lib/format";

type TopAuctionsListProps = {
  auctions: TopAuction[];
};

export function TopAuctionsList({ auctions }: TopAuctionsListProps): JSX.Element {
  return (
    <section className="h-full rounded-pv-lg border border-pv-line bg-pv-surface-2 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-pv-h3">Top auctions</h2>
        <span className="text-[11px] text-pv-muted">by winning bid</span>
      </div>

      {auctions.length === 0 ? (
        <p className="text-[13px] text-pv-muted">No auctions settled in this window.</p>
      ) : (
        <ul className="space-y-2 text-[13px]">
          {auctions.map((auction, index) => (
            <li key={auction.auctionId} className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-bold text-pv-text">{auction.cardName}</p>
                <p className="truncate text-[11px] text-pv-muted">
                  @{auction.hostUsername} · {formatDateTime(auction.settledAtIso)}
                </p>
              </div>
              <p
                className={`shrink-0 font-extrabold tabular-nums ${
                  index === 0 ? "text-pv-gold" : "text-pv-text"
                }`}
              >
                {formatMoneyCents(auction.winningBidCents)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
