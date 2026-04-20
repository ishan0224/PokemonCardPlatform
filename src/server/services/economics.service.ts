import Decimal from "decimal.js";
import { ApiRouteError } from "../http/api";
import { query } from "../db/pool";
import { PACK_TIER_CONFIGS, PACK_TIERS } from "../config/pack-tiers";
import { getAuctionSnipeMetrics } from "./auction-snipe-metrics.service";
import {
  AUCTION_FEE_BPS,
  ECONOMICS_DEFAULT_WINDOW_HOURS,
  ECONOMICS_INCIDENT_HOUSE_EDGE_DELTA_BPS,
  ECONOMICS_MAX_WINDOW_DAYS,
  RARITY_ANCHOR_FALLBACK_CENTS,
  TARGET_HOUSE_EDGE_BPS,
  TRADING_FEE_BPS
} from "../config/constants";
import type {
  EconomicsSummary,
  EconomicsWindow,
  HourlyRevenueBucket,
  IntegrityCheckResult,
  IntegrityChecks,
  PackEconomicsBundle,
  PackTier,
  PackTierCount,
  PackTierEconomics,
  RarityTier,
  RevenueStreamBreakdown,
  RevenueStreamKey,
  TopAuction,
  WorstPack
} from "../../lib/types";
import { RARITY_TIERS } from "../../lib/types";

const REVENUE_STREAM_KEYS: readonly RevenueStreamKey[] = [
  "pack_margin",
  "trade_fee",
  "auction_fee",
  "platform_discount",
  "manual_adjustment"
];

const FEE_MATH_EPSILON_BPS = 2;

export type WindowParams = { from: Date; to: Date };

const MAX_WINDOW_MS = ECONOMICS_MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000;

function parseIsoDate(value: string | null, label: string): Date | null {
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiRouteError(`${label} must be a valid ISO-8601 timestamp.`, 400, "INVALID_WINDOW", {
      field: label
    });
  }
  return parsed;
}

export function resolveEconomicsWindow(searchParams: URLSearchParams, now: Date = new Date()): WindowParams {
  const parsedTo = parseIsoDate(searchParams.get("to"), "to");
  const parsedFrom = parseIsoDate(searchParams.get("from"), "from");

  const to = parsedTo ?? now;
  const defaultFrom = new Date(to.getTime() - ECONOMICS_DEFAULT_WINDOW_HOURS * 60 * 60 * 1000);
  const from = parsedFrom ?? defaultFrom;

  if (from.getTime() >= to.getTime()) {
    throw new ApiRouteError("`from` must be earlier than `to`.", 400, "INVALID_WINDOW");
  }

  if (to.getTime() - from.getTime() > MAX_WINDOW_MS) {
    throw new ApiRouteError(
      `Window span exceeds ${ECONOMICS_MAX_WINDOW_DAYS} days.`,
      400,
      "INVALID_WINDOW",
      { maxDays: ECONOMICS_MAX_WINDOW_DAYS }
    );
  }

  if (to.getTime() > now.getTime() + 60_000) {
    throw new ApiRouteError("`to` cannot be more than a minute in the future.", 400, "INVALID_WINDOW");
  }

  return { from, to };
}

function toEconomicsWindow(params: WindowParams): EconomicsWindow {
  const durationMs = params.to.getTime() - params.from.getTime();
  const durationHours = Math.max(0, Math.round(durationMs / 3_600_000));
  return {
    fromIso: params.from.toISOString(),
    toIso: params.to.toISOString(),
    durationHours
  };
}

function bpsFromRatio(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }
  return new Decimal(numerator)
    .div(denominator)
    .mul(10_000)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
}

function absBps(value: number): number {
  return Math.abs(value);
}

async function fetchRevenueByStream(params: WindowParams): Promise<{
  breakdown: RevenueStreamBreakdown[];
  rowCount: number;
}> {
  const result = await query<{ type: RevenueStreamKey; total: string; row_count: string }>(
    `SELECT type,
            COALESCE(SUM(amount), 0)::BIGINT AS total,
            COUNT(*)::BIGINT AS row_count
     FROM platform_revenue
     WHERE created_at >= $1 AND created_at < $2
     GROUP BY type`,
    [params.from, params.to]
  );

  const map = new Map<RevenueStreamKey, RevenueStreamBreakdown>();
  let rowCount = 0;

  for (const row of result.rows) {
    const rows = Number(row.row_count);
    rowCount += rows;
    map.set(row.type, {
      stream: row.type,
      totalCents: Number(row.total),
      rowCount: rows
    });
  }

  const breakdown = REVENUE_STREAM_KEYS.map(
    (stream) => map.get(stream) ?? { stream, totalCents: 0, rowCount: 0 }
  );

  return { breakdown, rowCount };
}

async function fetchGmvBreakdown(params: WindowParams): Promise<{
  packCents: number;
  tradeCents: number;
  auctionCents: number;
  transactionRowCount: number;
  uniqueUsers: number;
}> {
  const gmvResult = await query<{ type: string; total: string }>(
    `SELECT type, COALESCE(SUM(ABS(amount)), 0)::BIGINT AS total
     FROM transactions
     WHERE type IN ('pack_purchase', 'trade_buy', 'auction_win')
       AND created_at >= $1 AND created_at < $2
     GROUP BY type`,
    [params.from, params.to]
  );

  const lookup = new Map<string, number>();
  for (const row of gmvResult.rows) {
    lookup.set(row.type, Number(row.total));
  }

  const scalarResult = await query<{ tx_count: string; unique_users: string }>(
    `SELECT COUNT(*)::BIGINT AS tx_count,
            COUNT(DISTINCT user_id)::BIGINT AS unique_users
     FROM transactions
     WHERE created_at >= $1 AND created_at < $2`,
    [params.from, params.to]
  );

  const scalarRow = scalarResult.rows[0];

  return {
    packCents: lookup.get("pack_purchase") ?? 0,
    tradeCents: lookup.get("trade_buy") ?? 0,
    auctionCents: lookup.get("auction_win") ?? 0,
    transactionRowCount: scalarRow ? Number(scalarRow.tx_count) : 0,
    uniqueUsers: scalarRow ? Number(scalarRow.unique_users) : 0
  };
}

async function fetchPacksByTier(params: WindowParams): Promise<{
  total: number;
  byTier: PackTierCount[];
}> {
  const result = await query<{ tier: PackTier; n: string }>(
    `SELECT p.tier::text AS tier, COUNT(*)::BIGINT AS n
     FROM platform_revenue pr
     JOIN packs p ON p.id = pr.reference_id
     WHERE pr.type = 'pack_margin'
       AND pr.created_at >= $1 AND pr.created_at < $2
     GROUP BY p.tier`,
    [params.from, params.to]
  );

  const lookup = new Map<PackTier, number>();
  let total = 0;
  for (const row of result.rows) {
    const n = Number(row.n);
    lookup.set(row.tier, n);
    total += n;
  }

  const byTier: PackTierCount[] = PACK_TIERS.map((tier) => ({
    tier,
    count: lookup.get(tier) ?? 0
  }));

  return { total, byTier };
}

async function fetchTradesExecuted(params: WindowParams): Promise<number> {
  const result = await query<{ n: string }>(
    `SELECT COUNT(*)::BIGINT AS n
     FROM platform_revenue
     WHERE type = 'trade_fee'
       AND created_at >= $1 AND created_at < $2`,
    [params.from, params.to]
  );

  return Number(result.rows[0]?.n ?? 0);
}

async function fetchAuctionStats(params: WindowParams): Promise<{
  settled: number;
  avgBidCents: number;
  maxBidCents: number;
}> {
  const result = await query<{ n: string; avg_bid: string; max_bid: string }>(
    `SELECT COUNT(*)::BIGINT AS n,
            COALESCE(AVG(a.current_bid), 0)::BIGINT AS avg_bid,
            COALESCE(MAX(a.current_bid), 0)::BIGINT AS max_bid
     FROM platform_revenue pr
     JOIN auctions a ON a.id = pr.reference_id
     WHERE pr.type = 'auction_fee'
       AND pr.created_at >= $1 AND pr.created_at < $2`,
    [params.from, params.to]
  );

  const row = result.rows[0];
  return {
    settled: row ? Number(row.n) : 0,
    avgBidCents: row ? Number(row.avg_bid) : 0,
    maxBidCents: row ? Number(row.max_bid) : 0
  };
}

async function fetchHourlySeries(params: WindowParams): Promise<HourlyRevenueBucket[]> {
  const result = await query<{ bucket: Date; type: RevenueStreamKey; amt: string }>(
    `SELECT date_trunc('hour', created_at) AS bucket,
            type,
            COALESCE(SUM(amount), 0)::BIGINT AS amt
     FROM platform_revenue
     WHERE created_at >= $1 AND created_at < $2
     GROUP BY bucket, type
     ORDER BY bucket`,
    [params.from, params.to]
  );

  const buckets = new Map<string, HourlyRevenueBucket>();
  for (const row of result.rows) {
    const iso = new Date(row.bucket).toISOString();
    const bucket = buckets.get(iso) ?? {
      hourIso: iso,
      packMarginCents: 0,
      tradeFeeCents: 0,
      auctionFeeCents: 0,
      netCents: 0
    };

    const amount = Number(row.amt);
    if (row.type === "pack_margin") {
      bucket.packMarginCents += amount;
    } else if (row.type === "trade_fee") {
      bucket.tradeFeeCents += amount;
    } else if (row.type === "auction_fee") {
      bucket.auctionFeeCents += amount;
    }
    bucket.netCents += amount;
    buckets.set(iso, bucket);
  }

  return Array.from(buckets.values()).sort((a, b) => a.hourIso.localeCompare(b.hourIso));
}

export async function getEconomicsSummary(params: WindowParams): Promise<EconomicsSummary> {
  const [revenue, gmv, packs, trades, auctionStats, hourly] = await Promise.all([
    fetchRevenueByStream(params),
    fetchGmvBreakdown(params),
    fetchPacksByTier(params),
    fetchTradesExecuted(params),
    fetchAuctionStats(params),
    fetchHourlySeries(params)
  ]);

  const gmvTotal = gmv.packCents + gmv.tradeCents + gmv.auctionCents;
  const netRevenue = revenue.breakdown.reduce((acc, entry) => acc + entry.totalCents, 0);
  const takeRateBps = bpsFromRatio(netRevenue, gmvTotal);

  return {
    window: toEconomicsWindow(params),
    generatedAtIso: new Date().toISOString(),
    gmvCents: gmvTotal,
    gmvPackCents: gmv.packCents,
    gmvTradeCents: gmv.tradeCents,
    gmvAuctionCents: gmv.auctionCents,
    netRevenueCents: netRevenue,
    takeRateBps,
    revenueByStream: revenue.breakdown,
    hourlySeries: hourly,
    uniqueUsers: gmv.uniqueUsers,
    packsPurchased: packs.total,
    packsPurchasedByTier: packs.byTier,
    tradesExecuted: trades,
    auctionsSettled: auctionStats.settled,
    auctionAverageWinningBidCents: auctionStats.avgBidCents,
    auctionMaxWinningBidCents: auctionStats.maxBidCents,
    platformRevenueRowCount: revenue.rowCount,
    transactionRowCount: gmv.transactionRowCount
  };
}

type PerTierMarginRow = {
  tier: PackTier;
  packs_purchased: string;
  sigma_margin: string;
  best_margin: string;
  worst_margin: string;
  avg_realized_ev: string;
};

async function fetchPerTierMargin(params: WindowParams): Promise<Map<PackTier, PerTierMarginRow>> {
  const result = await query<PerTierMarginRow>(
    `SELECT p.tier::text AS tier,
            COUNT(*)::BIGINT AS packs_purchased,
            COALESCE(SUM(pr.amount), 0)::BIGINT AS sigma_margin,
            COALESCE(MAX(pr.amount), 0)::BIGINT AS best_margin,
            COALESCE(MIN(pr.amount), 0)::BIGINT AS worst_margin,
            COALESCE(AVG(p.price_paid - pr.amount), 0)::BIGINT AS avg_realized_ev
     FROM platform_revenue pr
     JOIN packs p ON p.id = pr.reference_id
     WHERE pr.type = 'pack_margin'
       AND pr.created_at >= $1 AND pr.created_at < $2
     GROUP BY p.tier`,
    [params.from, params.to]
  );

  const map = new Map<PackTier, PerTierMarginRow>();
  for (const row of result.rows) {
    map.set(row.tier, row);
  }
  return map;
}

async function fetchRarityAnchors(): Promise<{
  anchors: Record<RarityTier, number>;
  sourceByRarity: Record<RarityTier, "live" | "fallback">;
}> {
  const result = await query<{ rarity_tier: RarityTier; anchor: string }>(
    `SELECT rarity_tier::text AS rarity_tier,
            COALESCE(AVG(current_price), 0)::BIGINT AS anchor
     FROM pokemon_cards
     GROUP BY rarity_tier`
  );

  const anchors = { ...RARITY_ANCHOR_FALLBACK_CENTS };
  const sourceByRarity = {} as Record<RarityTier, "live" | "fallback">;
  for (const rarity of RARITY_TIERS) {
    sourceByRarity[rarity] = "fallback";
  }

  for (const row of result.rows) {
    const value = Number(row.anchor);
    if (value > 0) {
      anchors[row.rarity_tier] = value;
      sourceByRarity[row.rarity_tier] = "live";
    }
  }

  return { anchors, sourceByRarity };
}

function computeTheoreticalEvCents(tier: PackTier, anchors: Record<RarityTier, number>): number {
  const config = PACK_TIER_CONFIGS[tier];
  let total = new Decimal(0);

  for (const slot of config.slots) {
    for (const entry of slot) {
      total = total.plus(new Decimal(anchors[entry.rarity]).mul(entry.weight));
    }
  }

  return total.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export async function getPackEconomics(params: WindowParams): Promise<{
  tiers: PackTierEconomics[];
  portfolio: PackEconomicsBundle["portfolio"];
}> {
  const [marginByTier, anchorResult] = await Promise.all([fetchPerTierMargin(params), fetchRarityAnchors()]);
  const { anchors, sourceByRarity } = anchorResult;

  const tiers: PackTierEconomics[] = PACK_TIERS.map((tier) => {
    const config = PACK_TIER_CONFIGS[tier];
    const priceCents = config.priceCents;
    const theoreticalEv = computeTheoreticalEvCents(tier, anchors);
    const theoreticalEdgeBps = bpsFromRatio(priceCents - theoreticalEv, priceCents);
    const usedRarities = new Set<RarityTier>();
    for (const slot of config.slots) {
      for (const entry of slot) {
        usedRarities.add(entry.rarity);
      }
    }
    const fallbackRarities = [...usedRarities].filter((rarity) => sourceByRarity[rarity] === "fallback");
    const anchorSource: PackTierEconomics["anchorSource"] =
      fallbackRarities.length === 0
        ? "live"
        : fallbackRarities.length === usedRarities.size
        ? "config"
        : "mixed";

    const row = marginByTier.get(tier);
    if (!row) {
      return {
        tier,
        displayName: config.displayName,
        priceCents,
        packsPurchased: 0,
        theoreticalEvCents: theoreticalEv,
        actualEvCents: null,
        theoreticalHouseEdgeBps: theoreticalEdgeBps,
        actualHouseEdgeBps: null,
        deltaHouseEdgeBps: null,
        sigmaMarginCents: 0,
        bestMarginCents: null,
        worstMarginCents: null,
        targetHouseEdgeBps: TARGET_HOUSE_EDGE_BPS[tier],
        anchorSource,
        anchorFallbackRarities: fallbackRarities.length > 0 ? fallbackRarities : undefined
      };
    }

    const packsPurchased = Number(row.packs_purchased);
    const actualEv = Number(row.avg_realized_ev);
    const actualEdgeBps = bpsFromRatio(priceCents - actualEv, priceCents);

    return {
      tier,
      displayName: config.displayName,
      priceCents,
      packsPurchased,
      theoreticalEvCents: theoreticalEv,
      actualEvCents: actualEv,
      theoreticalHouseEdgeBps: theoreticalEdgeBps,
      actualHouseEdgeBps: actualEdgeBps,
      deltaHouseEdgeBps: actualEdgeBps - theoreticalEdgeBps,
      sigmaMarginCents: Number(row.sigma_margin),
      bestMarginCents: Number(row.best_margin),
      worstMarginCents: Number(row.worst_margin),
      targetHouseEdgeBps: TARGET_HOUSE_EDGE_BPS[tier],
      anchorSource,
      anchorFallbackRarities: fallbackRarities.length > 0 ? fallbackRarities : undefined
    };
  });

  const totalPacks = tiers.reduce((acc, entry) => acc + entry.packsPurchased, 0);
  const sigmaMargin = tiers.reduce((acc, entry) => acc + entry.sigmaMarginCents, 0);
  const weightedActual = tiers.reduce((acc, entry) => {
    if (entry.actualEvCents === null) {
      return acc;
    }
    return acc + entry.actualEvCents * entry.packsPurchased;
  }, 0);
  const weightedPrice = tiers.reduce((acc, entry) => acc + entry.priceCents * entry.packsPurchased, 0);
  const weightedTheoretical = tiers.reduce(
    (acc, entry) => acc + entry.theoreticalEvCents * entry.packsPurchased,
    0
  );

  const portfolio: PackEconomicsBundle["portfolio"] = {
    packsPurchased: totalPacks,
    sigmaMarginCents: sigmaMargin,
    actualHouseEdgeBps: weightedPrice > 0 ? bpsFromRatio(weightedPrice - weightedActual, weightedPrice) : null,
    theoreticalHouseEdgeBps:
      weightedPrice > 0 ? bpsFromRatio(weightedPrice - weightedTheoretical, weightedPrice) : 0
  };

  return { tiers, portfolio };
}

export async function getWorstPacks(params: WindowParams, limit = 5): Promise<WorstPack[]> {
  const [result, totalNegativeResult] = await Promise.all([
    query<{
      pack_id: string;
      tier: PackTier;
      margin: string;
      price_paid: string;
      buyer_id: string;
      purchased_at: Date;
    }>(
      `SELECT p.id AS pack_id,
              p.tier::text AS tier,
              pr.amount::BIGINT AS margin,
              p.price_paid::BIGINT AS price_paid,
              p.user_id::text AS buyer_id,
              p.purchased_at AS purchased_at
       FROM platform_revenue pr
       JOIN packs p ON p.id = pr.reference_id
       WHERE pr.type = 'pack_margin'
         AND pr.created_at >= $1 AND pr.created_at < $2
       ORDER BY pr.amount ASC
       LIMIT $3`,
      [params.from, params.to, limit]
    ),
    query<{ total_bleed: string }>(
      `SELECT COALESCE(SUM(amount), 0)::BIGINT AS total_bleed
       FROM platform_revenue
       WHERE type = 'pack_margin'
         AND amount < 0
         AND created_at >= $1 AND created_at < $2`,
      [params.from, params.to]
    )
  ]);

  const windowBleedCents = Math.abs(Number(totalNegativeResult.rows[0]?.total_bleed ?? 0));

  return result.rows.map<WorstPack>((row) => {
    const margin = Number(row.margin);
    const pricePaid = Number(row.price_paid);
    const realizedEv = pricePaid - margin;
    const shareBps =
      windowBleedCents > 0 && margin < 0 ? bpsFromRatio(Math.abs(margin), windowBleedCents) : null;

    return {
      packId: row.pack_id,
      tier: row.tier,
      pricePaidCents: pricePaid,
      marginCents: margin,
      realizedEvCents: realizedEv,
      buyerIdPrefix: row.buyer_id.slice(0, 8),
      purchasedAtIso: new Date(row.purchased_at).toISOString(),
      shareOfTotalBleedBps: shareBps
    };
  });
}

export async function getTopAuctions(params: WindowParams, limit = 5): Promise<TopAuction[]> {
  const result = await query<{
    auction_id: string;
    winning_bid: string;
    fee: string;
    settled_at: Date;
    winner_id: string | null;
    host_username: string;
    card_name: string;
    card_image_url: string | null;
  }>(
    `SELECT a.id AS auction_id,
            COALESCE(a.current_bid, 0)::BIGINT AS winning_bid,
            pr.amount::BIGINT AS fee,
            pr.created_at AS settled_at,
            (a.current_bidder_id)::text AS winner_id,
            u.username AS host_username,
            pc.name AS card_name,
            COALESCE(pc.image_url_hires, pc.image_url) AS card_image_url
     FROM platform_revenue pr
     JOIN auctions a ON a.id = pr.reference_id
     JOIN users u ON u.id = a.seller_id
     JOIN cards c ON c.id = a.card_id
     JOIN pokemon_cards pc ON pc.id = c.pokemon_card_id
     WHERE pr.type = 'auction_fee'
       AND pr.created_at >= $1 AND pr.created_at < $2
     ORDER BY a.current_bid DESC NULLS LAST, pr.created_at DESC
     LIMIT $3`,
    [params.from, params.to, limit]
  );

  return result.rows.map<TopAuction>((row) => ({
    auctionId: row.auction_id,
    winningBidCents: Number(row.winning_bid),
    feeCapturedCents: Number(row.fee),
    settledAtIso: new Date(row.settled_at).toISOString(),
    winnerIdPrefix: row.winner_id ? row.winner_id.slice(0, 8) : null,
    hostUsername: row.host_username,
    cardName: row.card_name,
    cardImageUrl: row.card_image_url
  }));
}

async function checkFeeMath(params: WindowParams): Promise<{
  tradeBps: number;
  auctionBps: number;
  tradeGmvCents: number;
  auctionGmvCents: number;
  tradeFeeCents: number;
  auctionFeeCents: number;
}> {
  const result = await query<{
    trade_fee: string;
    auction_fee: string;
    trade_gmv: string;
    auction_gmv: string;
  }>(
    `SELECT
       (SELECT COALESCE(SUM(amount), 0)::BIGINT
        FROM platform_revenue
        WHERE type = 'trade_fee' AND created_at >= $1 AND created_at < $2) AS trade_fee,
       (SELECT COALESCE(SUM(amount), 0)::BIGINT
        FROM platform_revenue
        WHERE type = 'auction_fee' AND created_at >= $1 AND created_at < $2) AS auction_fee,
       (SELECT COALESCE(SUM(ABS(amount)), 0)::BIGINT
        FROM transactions
        WHERE type = 'trade_buy' AND created_at >= $1 AND created_at < $2) AS trade_gmv,
       (SELECT COALESCE(SUM(ABS(amount)), 0)::BIGINT
        FROM transactions
        WHERE type = 'auction_win' AND created_at >= $1 AND created_at < $2) AS auction_gmv`,
    [params.from, params.to]
  );

  const row = result.rows[0];
  const tradeFee = row ? Number(row.trade_fee) : 0;
  const auctionFee = row ? Number(row.auction_fee) : 0;
  const tradeGmv = row ? Number(row.trade_gmv) : 0;
  const auctionGmv = row ? Number(row.auction_gmv) : 0;

  return {
    tradeFeeCents: tradeFee,
    auctionFeeCents: auctionFee,
    tradeGmvCents: tradeGmv,
    auctionGmvCents: auctionGmv,
    tradeBps: bpsFromRatio(tradeFee, tradeGmv),
    auctionBps: bpsFromRatio(auctionFee, auctionGmv)
  };
}

async function checkDoubleEntry(params: WindowParams): Promise<{ totalAuctions: number; unbalanced: number }> {
  const result = await query<{ total: string; unbalanced: string }>(
    `WITH window_auctions AS (
       SELECT reference_id AS auction_id, amount AS platform_fee
       FROM platform_revenue
       WHERE type = 'auction_fee'
         AND reference_id IS NOT NULL
         AND created_at >= $1 AND created_at < $2
     )
     SELECT COUNT(*)::BIGINT AS total,
            COALESCE(SUM(CASE WHEN delta <> 0 THEN 1 ELSE 0 END), 0)::BIGINT AS unbalanced
     FROM (
       SELECT wa.auction_id,
              wa.platform_fee
                + COALESCE((SELECT SUM(amount)::BIGINT
                            FROM transactions t
                            WHERE t.reference_id = wa.auction_id
                              AND t.type IN ('auction_win', 'auction_sell', 'auction_fee')), 0) AS delta
       FROM window_auctions wa
     ) AS balanced`,
    [params.from, params.to]
  );

  const row = result.rows[0];
  return {
    totalAuctions: row ? Number(row.total) : 0,
    unbalanced: row ? Number(row.unbalanced) : 0
  };
}

async function checkTradeSymmetry(params: WindowParams): Promise<{
  buys: number;
  sells: number;
}> {
  const result = await query<{ type: string; n: string }>(
    `SELECT type, COUNT(*)::BIGINT AS n
     FROM transactions
     WHERE type IN ('trade_buy', 'trade_sell')
       AND created_at >= $1 AND created_at < $2
     GROUP BY type`,
    [params.from, params.to]
  );

  const lookup = new Map<string, number>();
  for (const row of result.rows) {
    lookup.set(row.type, Number(row.n));
  }

  return {
    buys: lookup.get("trade_buy") ?? 0,
    sells: lookup.get("trade_sell") ?? 0
  };
}

export async function getIntegrityChecks(
  params: WindowParams,
  tierResults: PackTierEconomics[]
): Promise<IntegrityChecks> {
  const [fees, doubleEntry, tradeSymmetry] = await Promise.all([
    checkFeeMath(params),
    checkDoubleEntry(params),
    checkTradeSymmetry(params)
  ]);

  const tiersLosingMoneyCount = tierResults.filter(
    (tier) => tier.packsPurchased > 0 && tier.sigmaMarginCents < 0
  ).length;

  const tradeDeltaBps =
    fees.tradeGmvCents === 0 ? 0 : absBps(fees.tradeBps - TRADING_FEE_BPS);
  const auctionDeltaBps =
    fees.auctionGmvCents === 0 ? 0 : absBps(fees.auctionBps - AUCTION_FEE_BPS);
  const feeWithinEpsilon =
    tradeDeltaBps <= FEE_MATH_EPSILON_BPS && auctionDeltaBps <= FEE_MATH_EPSILON_BPS;

  const checks: IntegrityCheckResult[] = [
    {
      key: "tiers_losing_money",
      label: "Tiers losing money",
      status: tiersLosingMoneyCount === 0 ? "pass" : "fail",
      detail: `${tiersLosingMoneyCount} of ${tierResults.length}`
    },
    {
      key: "fee_math",
      label: "Fee math",
      status: feeWithinEpsilon ? "pass" : "warn",
      detail:
        fees.tradeGmvCents === 0 && fees.auctionGmvCents === 0
          ? "no trade/auction flow in window"
          : `trade ${(fees.tradeBps / 100).toFixed(2)}% · auction ${(fees.auctionBps / 100).toFixed(2)}%`
    },
    {
      key: "double_entry",
      label: "Double-entry",
      status: doubleEntry.unbalanced === 0 ? "pass" : "fail",
      detail:
        doubleEntry.totalAuctions === 0
          ? "no auctions settled in window"
          : `${doubleEntry.totalAuctions - doubleEntry.unbalanced} / ${doubleEntry.totalAuctions} balance`
    },
    {
      key: "trade_symmetry",
      label: "Trade symmetry",
      status: tradeSymmetry.buys === tradeSymmetry.sells ? "pass" : "fail",
      detail:
        tradeSymmetry.buys === 0 && tradeSymmetry.sells === 0
          ? "no trades in window"
          : `${tradeSymmetry.buys} buys = ${tradeSymmetry.sells} sells`
    }
  ];

  return { checks, tiersLosingMoneyCount };
}

export async function getPackEconomicsBundle(params: WindowParams): Promise<PackEconomicsBundle> {
  const { tiers, portfolio } = await getPackEconomics(params);
  const [worstPacks, topAuctions, integrity, auctionSnipeMetrics] = await Promise.all([
    getWorstPacks(params),
    getTopAuctions(params),
    getIntegrityChecks(params, tiers),
    getAuctionSnipeMetrics(params)
  ]);

  return {
    window: toEconomicsWindow(params),
    generatedAtIso: new Date().toISOString(),
    tiers,
    portfolio,
    worstPacks,
    topAuctions,
    integrity,
    auctionSnipeMetrics
  };
}

export function buildMarginIncidentEvidence(bundle: PackEconomicsBundle): Record<string, unknown> | null {
  const outOfBandTiers = bundle.tiers
    .map((tier) => {
      if (tier.actualHouseEdgeBps === null) {
        return null;
      }

      const deltaBps = Math.abs(tier.actualHouseEdgeBps - tier.targetHouseEdgeBps);
      if (deltaBps <= ECONOMICS_INCIDENT_HOUSE_EDGE_DELTA_BPS) {
        return null;
      }

      return {
        tier: tier.tier,
        actualHouseEdgeBps: tier.actualHouseEdgeBps,
        targetHouseEdgeBps: tier.targetHouseEdgeBps,
        deltaBps,
        packsPurchased: tier.packsPurchased,
        sigmaMarginCents: tier.sigmaMarginCents
      };
    })
    .filter((tier): tier is NonNullable<typeof tier> => tier !== null);

  if (bundle.integrity.tiersLosingMoneyCount === 0 && outOfBandTiers.length === 0) {
    return null;
  }

  return {
    incidentDeltaBps: ECONOMICS_INCIDENT_HOUSE_EDGE_DELTA_BPS,
    tiersLosingMoneyCount: bundle.integrity.tiersLosingMoneyCount,
    outOfBandTiers,
    window: bundle.window
  };
}
