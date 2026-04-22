import { query } from "../db/pool";

type WindowParams = { from: Date; to: Date };

// Phase 5 B3 wash-trade heuristics — source plan §475.
// All helpers are read-only aggregations against completed auctions in the window.

export type RepeatPairFinding = {
  buyerId: string;
  sellerId: string;
  auctionCount: number;
  auctionIds: string[];
};

export type LoneBidderFinding = {
  auctionId: string;
  winningBidderId: string;
  sellerId: string;
  finalPrice: number;
  marketValue: number;
  marketValueRatio: number;
};

export type RapidFlipFinding = {
  auctionId: string;
  cardId: string;
  winningBidderId: string;
  soldViaListingId: string | null;
  relistedAuctionId: string | null;
  closedAt: string;
  resoldOrRelistedAt: string;
  elapsedHours: number;
};

export type WashTradeReport = {
  window: { fromIso: string; toIso: string };
  repeatBuyerSellerPairs: RepeatPairFinding[];
  loneBidderBelowMarket: LoneBidderFinding[];
  rapidFlipsWithin24h: RapidFlipFinding[];
};

const REPEAT_PAIR_MIN_COUNT = 2;
export const LONE_BIDDER_MARKET_RATIO_THRESHOLD = 0.4;
const RAPID_FLIP_WINDOW_HOURS = 24;

async function findRepeatBuyerSellerPairs(params: WindowParams): Promise<RepeatPairFinding[]> {
  const result = await query<{
    buyer_id: string;
    seller_id: string;
    auction_count: string;
    auction_ids: string[];
  }>(
    `SELECT a.current_bidder_id AS buyer_id,
            a.seller_id AS seller_id,
            COUNT(*)::BIGINT AS auction_count,
            ARRAY_AGG(a.id ORDER BY a.ends_at) AS auction_ids
     FROM auctions a
     WHERE a.status = 'completed'
       AND a.current_bidder_id IS NOT NULL
       AND a.ends_at >= $1
       AND a.ends_at <= $2
     GROUP BY a.current_bidder_id, a.seller_id
     HAVING COUNT(*) >= $3
     ORDER BY COUNT(*) DESC`,
    [params.from, params.to, REPEAT_PAIR_MIN_COUNT]
  );

  return result.rows.map((row) => ({
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    auctionCount: Number(row.auction_count),
    auctionIds: row.auction_ids
  }));
}

async function findLoneBidderBelowMarketCloses(params: WindowParams): Promise<LoneBidderFinding[]> {
  const result = await query<{
    auction_id: string;
    winning_bidder_id: string;
    seller_id: string;
    final_price: string;
    market_value: string;
  }>(
    `WITH completed AS (
       SELECT a.id,
              a.current_bidder_id AS winning_bidder_id,
              a.seller_id,
              a.current_bid AS final_price,
              c.pokemon_card_id
       FROM auctions a
       JOIN cards c ON c.id = a.card_id
       WHERE a.status = 'completed'
         AND a.current_bidder_id IS NOT NULL
         AND a.current_bid IS NOT NULL
         AND a.ends_at >= $1
         AND a.ends_at <= $2
     ),
     bid_counts AS (
       SELECT auction_id, COUNT(DISTINCT bidder_id)::BIGINT AS distinct_bidders
       FROM bids
       GROUP BY auction_id
     )
     SELECT completed.id AS auction_id,
            completed.winning_bidder_id,
            completed.seller_id,
            completed.final_price::TEXT AS final_price,
            pc.current_price::TEXT AS market_value
     FROM completed
     JOIN bid_counts ON bid_counts.auction_id = completed.id
     JOIN pokemon_cards pc ON pc.id = completed.pokemon_card_id
     WHERE bid_counts.distinct_bidders = 1
       AND pc.current_price > 0
       AND completed.final_price < (pc.current_price * $3::numeric)`,
    [params.from, params.to, LONE_BIDDER_MARKET_RATIO_THRESHOLD]
  );

  return result.rows.map((row) => {
    const finalPrice = Number(row.final_price);
    const marketValue = Number(row.market_value);
    const ratio = marketValue === 0 ? 0 : finalPrice / marketValue;
    return {
      auctionId: row.auction_id,
      winningBidderId: row.winning_bidder_id,
      sellerId: row.seller_id,
      finalPrice,
      marketValue,
      marketValueRatio: ratio
    };
  });
}

async function findRapidFlipsWithin24h(params: WindowParams): Promise<RapidFlipFinding[]> {
  // Phase 5 B3 QA fix M-2: dedupe by (auction_id, card_id). A won card that is
  // both relisted-as-auction AND listed-for-sale by its winner within the
  // window would otherwise produce two rows. DISTINCT ON keeps the earliest
  // resell event per won-auction; populated listing_id / relisted_auction_id
  // reflects whichever flip happened first.
  const result = await query<{
    auction_id: string;
    card_id: string;
    winning_bidder_id: string;
    closed_at: string;
    relisted_listing_id: string | null;
    relisted_auction_id: string | null;
    resold_at: string;
    elapsed_hours: string;
  }>(
    `WITH won AS (
       SELECT a.id AS auction_id,
              a.card_id,
              a.current_bidder_id AS winning_bidder_id,
              a.ends_at AS closed_at
       FROM auctions a
       WHERE a.status = 'completed'
         AND a.current_bidder_id IS NOT NULL
         AND a.ends_at >= $1
         AND a.ends_at <= $2
     ),
     flips AS (
       SELECT won.auction_id,
              won.card_id,
              won.winning_bidder_id,
              won.closed_at,
              l.id AS listing_id,
              NULL::UUID AS relisted_auction_id,
              l.created_at AS resold_at
       FROM won
       JOIN listings l ON l.card_id = won.card_id
        AND l.seller_id = won.winning_bidder_id
        AND l.created_at > won.closed_at
        AND l.created_at <= won.closed_at + make_interval(hours => $3)
       UNION ALL
       SELECT won.auction_id,
              won.card_id,
              won.winning_bidder_id,
              won.closed_at,
              NULL::UUID AS listing_id,
              a2.id AS relisted_auction_id,
              a2.created_at AS resold_at
       FROM won
       JOIN auctions a2 ON a2.card_id = won.card_id
        AND a2.seller_id = won.winning_bidder_id
        AND a2.created_at > won.closed_at
        AND a2.created_at <= won.closed_at + make_interval(hours => $3)
     )
     SELECT DISTINCT ON (auction_id, card_id)
            auction_id,
            card_id,
            winning_bidder_id,
            closed_at::TEXT AS closed_at,
            listing_id AS relisted_listing_id,
            relisted_auction_id,
            resold_at::TEXT AS resold_at,
            EXTRACT(EPOCH FROM (resold_at - closed_at)) / 3600 AS elapsed_hours
     FROM flips
     ORDER BY auction_id, card_id, resold_at ASC`,
    [params.from, params.to, RAPID_FLIP_WINDOW_HOURS]
  );

  return result.rows.map((row) => ({
    auctionId: row.auction_id,
    cardId: row.card_id,
    winningBidderId: row.winning_bidder_id,
    soldViaListingId: row.relisted_listing_id,
    relistedAuctionId: row.relisted_auction_id,
    closedAt: row.closed_at,
    resoldOrRelistedAt: row.resold_at,
    elapsedHours: Number(row.elapsed_hours)
  }));
}

export async function getWashTradeReport(params: WindowParams): Promise<WashTradeReport> {
  const [repeatBuyerSellerPairs, loneBidderBelowMarket, rapidFlipsWithin24h] = await Promise.all([
    findRepeatBuyerSellerPairs(params),
    findLoneBidderBelowMarketCloses(params),
    findRapidFlipsWithin24h(params)
  ]);

  return {
    window: { fromIso: params.from.toISOString(), toIso: params.to.toISOString() },
    repeatBuyerSellerPairs,
    loneBidderBelowMarket,
    rapidFlipsWithin24h
  };
}
