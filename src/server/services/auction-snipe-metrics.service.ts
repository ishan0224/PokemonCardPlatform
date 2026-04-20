import { query } from "../db/pool";
import type { AuctionSnipeMetrics, BidsInFinal10PctMetric } from "../../lib/types";

type WindowParams = { from: Date; to: Date };

type ExtensionTriggerRow = {
  total: string;
  extended: string;
};

type BidsInFinal10PctRow = {
  auction_count: string;
  total_bids: string;
  final_window_bids: string;
};

// Phase 5 B3 snipe metrics — source plan §471–§473.
// Read-only aggregations; never mutate auction state. `auctions.original_end_time`
// is populated at auction creation (Phase 0 schema) and captures the initial
// ends_at independent of any soft-close extensions.

async function getExtensionTriggerRate(params: WindowParams): Promise<number> {
  const result = await query<ExtensionTriggerRow>(
    `SELECT COUNT(*)::BIGINT AS total,
            COUNT(*) FILTER (WHERE ends_at > original_end_time)::BIGINT AS extended
     FROM auctions
     WHERE status = 'completed'
       AND ends_at >= $1
       AND ends_at <= $2`,
    [params.from, params.to]
  );

  const row = result.rows[0];
  const total = Number(row?.total ?? 0);
  const extended = Number(row?.extended ?? 0);

  if (total === 0) {
    return 0;
  }

  return extended / total;
}

async function getBidsInFinal10Pct(params: WindowParams): Promise<BidsInFinal10PctMetric> {
  const result = await query<BidsInFinal10PctRow>(
    `WITH completed AS (
       SELECT a.id,
              a.created_at,
              a.original_end_time,
              GREATEST(EXTRACT(EPOCH FROM (a.original_end_time - a.created_at)), 0) AS lifetime_secs
       FROM auctions a
       WHERE a.status = 'completed'
         AND a.ends_at >= $1
         AND a.ends_at <= $2
     )
     SELECT COUNT(DISTINCT c.id)::BIGINT AS auction_count,
            COUNT(b.id)::BIGINT AS total_bids,
            COUNT(b.id) FILTER (
              WHERE c.lifetime_secs > 0
                AND b.created_at >= c.original_end_time - make_interval(secs => c.lifetime_secs * 0.1)
            )::BIGINT AS final_window_bids
     FROM completed c
     LEFT JOIN bids b ON b.auction_id = c.id`,
    [params.from, params.to]
  );

  const row = result.rows[0];
  const auctionCount = Number(row?.auction_count ?? 0);
  const totalBids = Number(row?.total_bids ?? 0);
  const finalWindowBids = Number(row?.final_window_bids ?? 0);
  const rate = totalBids === 0 ? 0 : finalWindowBids / totalBids;

  return { auctionCount, totalBids, finalWindowBids, rate };
}

export async function getAuctionSnipeMetrics(params: WindowParams): Promise<AuctionSnipeMetrics> {
  const [extensionTriggerRate, bidsInFinal10Pct] = await Promise.all([
    getExtensionTriggerRate(params),
    getBidsInFinal10Pct(params)
  ]);

  return {
    extensionTriggerRate,
    bidsInFinal10Pct
  };
}
