import type { RarityTier } from "../src/lib/types";
import {
  chooseHigherLiquidityTier,
  computeNextPriceRefreshAt,
  defaultLiquidityTierForRarity
} from "../src/server/config/price-liquidity";
import { closeDatabasePool, query, withTransaction } from "../src/server/db/pool";

type PriceLiquidityMetricRow = {
  id: string;
  rarity_tier: RarityTier;
  active_instances: string;
  active_listings: string;
  active_auctions: string;
  bids_30d: string;
};

type LiquidityTierUpdate = {
  id: string;
  liquidityTier: "high" | "medium" | "low" | "illiquid";
  nextPriceRefreshAtIso: string;
};

const HIGH_SCORE_THRESHOLD = 20;
const MEDIUM_SCORE_THRESHOLD = 8;
const LOW_SCORE_THRESHOLD = 2;

function toInt(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function resolveLiquidityTier(row: PriceLiquidityMetricRow): "high" | "medium" | "low" | "illiquid" {
  const activeInstances = toInt(row.active_instances);
  const activeListings = toInt(row.active_listings);
  const activeAuctions = toInt(row.active_auctions);
  const bids30d = toInt(row.bids_30d);

  const activityScore = bids30d * 5 + activeAuctions * 8 + activeListings * 3 + activeInstances;
  let tier = defaultLiquidityTierForRarity(row.rarity_tier);

  if (activeAuctions > 0 || bids30d >= 3 || activityScore >= HIGH_SCORE_THRESHOLD) {
    tier = chooseHigherLiquidityTier(tier, "high");
  } else if (activeListings > 0 || activityScore >= MEDIUM_SCORE_THRESHOLD) {
    tier = chooseHigherLiquidityTier(tier, "medium");
  } else if (activeInstances > 0 || activityScore >= LOW_SCORE_THRESHOLD) {
    tier = chooseHigherLiquidityTier(tier, "low");
  }

  return tier;
}

async function readMetrics(): Promise<PriceLiquidityMetricRow[]> {
  const result = await query<PriceLiquidityMetricRow>(
    `WITH owned AS (
       SELECT pokemon_card_id,
              COUNT(*) FILTER (WHERE state <> 'in_pack') AS active_instances
       FROM cards
       GROUP BY pokemon_card_id
     ),
     active_listings AS (
       SELECT c.pokemon_card_id,
              COUNT(*) AS active_listings
       FROM listings l
       JOIN cards c ON c.id = l.card_id
       WHERE l.status = 'active'
       GROUP BY c.pokemon_card_id
     ),
     active_auctions AS (
       SELECT c.pokemon_card_id,
              COUNT(*) AS active_auctions
       FROM auctions a
       JOIN cards c ON c.id = a.card_id
       WHERE a.status = 'active'
       GROUP BY c.pokemon_card_id
     ),
     bids_30d AS (
       SELECT c.pokemon_card_id,
              COUNT(*) AS bids_30d
       FROM bids b
       JOIN auctions a ON a.id = b.auction_id
       JOIN cards c ON c.id = a.card_id
       WHERE b.created_at >= now() - interval '30 days'
       GROUP BY c.pokemon_card_id
     )
     SELECT pc.id,
            pc.rarity_tier,
            COALESCE(o.active_instances, 0)::text AS active_instances,
            COALESCE(l.active_listings, 0)::text AS active_listings,
            COALESCE(au.active_auctions, 0)::text AS active_auctions,
            COALESCE(b.bids_30d, 0)::text AS bids_30d
     FROM pokemon_cards pc
     LEFT JOIN owned o ON o.pokemon_card_id = pc.id
     LEFT JOIN active_listings l ON l.pokemon_card_id = pc.id
     LEFT JOIN active_auctions au ON au.pokemon_card_id = pc.id
     LEFT JOIN bids_30d b ON b.pokemon_card_id = pc.id
     ORDER BY pc.id ASC`
  );

  return result.rows;
}

function summarizePlannedUpdates(updates: LiquidityTierUpdate[]): Record<string, number> {
  return updates.reduce<Record<string, number>>((acc, update) => {
    acc[update.liquidityTier] = (acc[update.liquidityTier] ?? 0) + 1;
    return acc;
  }, {});
}

async function applyUpdates(updates: LiquidityTierUpdate[]): Promise<void> {
  if (updates.length === 0) {
    return;
  }

  await withTransaction(async (client) => {
    for (const update of updates) {
      await client.query(
        `UPDATE pokemon_cards
         SET liquidity_tier = $2,
             next_price_refresh_at = $3
         WHERE id = $1`,
        [update.id, update.liquidityTier, update.nextPriceRefreshAtIso]
      );
    }
  });
}

async function readNullCounts(): Promise<{ nullTierCount: number; nullNextRefreshCount: number }> {
  const result = await query<{ null_tier_count: string; null_next_refresh_count: string }>(
    `SELECT COUNT(*) FILTER (WHERE liquidity_tier IS NULL)::text AS null_tier_count,
            COUNT(*) FILTER (WHERE next_price_refresh_at IS NULL)::text AS null_next_refresh_count
     FROM pokemon_cards`
  );

  return {
    nullTierCount: toInt(result.rows[0]?.null_tier_count ?? "0"),
    nullNextRefreshCount: toInt(result.rows[0]?.null_next_refresh_count ?? "0")
  };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  const rows = await readMetrics();
  const now = new Date();
  const updates: LiquidityTierUpdate[] = rows.map((row) => {
    const liquidityTier = resolveLiquidityTier(row);
    const nextPriceRefreshAt = computeNextPriceRefreshAt(liquidityTier, now);

    return {
      id: row.id,
      liquidityTier,
      nextPriceRefreshAtIso: nextPriceRefreshAt.toISOString()
    };
  });

  const summary = summarizePlannedUpdates(updates);
  console.log(`[backfill:price-liquidity] computed=${updates.length} summary=${JSON.stringify(summary)}`);

  if (dryRun) {
    console.log("[backfill:price-liquidity] dry run complete (no DB writes).");
    return;
  }

  await applyUpdates(updates);
  const nullCounts = await readNullCounts();

  console.log(
    `[backfill:price-liquidity] applied=${updates.length} nullTier=${nullCounts.nullTierCount} nullNextRefresh=${nullCounts.nullNextRefreshCount}`
  );
}

main()
  .catch((error) => {
    console.error("[backfill:price-liquidity] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabasePool();
  });
