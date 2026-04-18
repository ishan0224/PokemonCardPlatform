import type { TopAuction } from "@/lib/types";
import { formatDateTime, formatMoneyCents, formatSignedMoneyCents } from "@/lib/format";
import { LeaderboardItem } from "./leaderboard-item";

type TopAuctionsListProps = {
  auctions: TopAuction[];
};

export function TopAuctionsList({ auctions }: TopAuctionsListProps): JSX.Element {
  return (
    <section className="h-full w-full rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">Top auctions · window</h2>
      <p className="mt-1 text-xs text-slate-500">Gavel price and captured 8% platform fee.</p>

      {auctions.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No auctions settled in this window.</p>
      ) : (
        <ol className="mt-4 space-y-2 text-sm">
          {auctions.map((auction, index) => (
            <li key={auction.auctionId}>
              <LeaderboardItem
                rank={index + 1}
                avatar={{
                  kind: "image",
                  imageUrl: auction.cardImageUrl ?? "",
                  alt: auction.cardName,
                  fallbackLabel: "A",
                  fallbackClassName: "bg-emerald-100 text-emerald-700"
                }}
                title={auction.cardName}
                subtitle={
                  <span>
                    {`${auction.hostUsername}'s Auction`} · {formatDateTime(auction.settledAtIso)}
                  </span>
                }
                primaryValue={formatMoneyCents(auction.winningBidCents)}
                secondaryValue={
                  <span className="text-emerald-600">fee {formatSignedMoneyCents(auction.feeCapturedCents)}</span>
                }
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
