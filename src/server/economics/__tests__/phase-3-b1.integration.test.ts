import { describe, expect, it } from "vitest";
import { query } from "../../db/pool";
import {
  rebalanceEconomics,
  simulateEconomicsRebalance,
  type EconomicsSimulateKnobs
} from "../rebalance";
import type { GenerationEligibleIdsByTier } from "../../services/pack-generation-version.service";

const hasDatabase = Boolean(process.env.DATABASE_URL);
if (!hasDatabase) {
  console.warn("[test:partb:phase3:integration] SKIP: DATABASE_URL is not configured.");
}

const describeDb = hasDatabase ? describe : describe.skip;

async function withTemporaryCardPriceDelta<T>(delta: number, work: () => Promise<T>): Promise<T> {
  const latest = await query<{ eligible_card_ids_json: GenerationEligibleIdsByTier }>(
    `SELECT eligible_card_ids_json
     FROM pack_generation_versions
     ORDER BY version_number DESC
     LIMIT 1`
  );

  if (latest.rowCount !== 1) {
    throw new Error("No generation version found for integration test fixture.");
  }

  const sampleId = latest.rows[0].eligible_card_ids_json.standard.common[0];
  const current = await query<{ current_price: string }>(
    `SELECT current_price::text AS current_price
     FROM pokemon_cards
     WHERE id = $1`,
    [sampleId]
  );

  if (current.rowCount !== 1) {
    throw new Error("No sample card found for integration test fixture.");
  }

  const original = Number(current.rows[0].current_price);
  await query(`UPDATE pokemon_cards SET current_price = $2 WHERE id = $1`, [sampleId, original + delta]);

  try {
    return await work();
  } finally {
    await query(`UPDATE pokemon_cards SET current_price = $2 WHERE id = $1`, [sampleId, original]);
  }
}

describeDb("Phase 3 B1 rebalance integration", () => {
  it("advisory-lock contention inserts at most one row for identical concurrent rebalance", async () => {
    await withTemporaryCardPriceDelta(137, async () => {
      const before = await query<{ count: string }>("SELECT COUNT(*)::BIGINT AS count FROM pack_generation_versions");

      const knobs: EconomicsSimulateKnobs = {
        ultraRareMaxWeight: 0.19,
        chaseMaxWeight: 0.11
      };

      const [first, second] = await Promise.all([
        rebalanceEconomics({ actorUserId: null, knobs }),
        rebalanceEconomics({ actorUserId: null, knobs })
      ]);

      const after = await query<{ count: string }>("SELECT COUNT(*)::BIGINT AS count FROM pack_generation_versions");
      const insertedDelta = Number(after.rows[0].count) - Number(before.rows[0].count);

      expect(insertedDelta).toBeLessThanOrEqual(1);
      if (first.action === "inserted" || second.action === "inserted") {
        expect(insertedDelta).toBe(1);
      }

      expect(first.version.id).toBe(second.version.id);
      expect(["inserted", "no_op"]).toContain(first.action);
      expect(["inserted", "no_op"]).toContain(second.action);
      expect(first.anchorSource).toBe("live_current_price_eligible_catalog");
      expect(second.anchorSource).toBe("live_current_price_eligible_catalog");
    });
  });

  it("records security event for infeasible tier while allowing other tiers", async () => {
    const beforeEvents = await query<{ count: string }>(
      `SELECT COUNT(*)::BIGINT AS count
       FROM security_events
       WHERE event_type = 'econ_rebalance_infeasible'`
    );

    const knobs: EconomicsSimulateKnobs = {
      targetEdgeByTier: {
        standard: 0.99,
        premium: 0,
        elite: 0
      },
      winRateFloorByTier: {
        standard: 0.99,
        premium: 0,
        elite: 0
      }
    };

    const result = await rebalanceEconomics({ actorUserId: null, knobs });

    const afterEvents = await query<{ count: string }>(
      `SELECT COUNT(*)::BIGINT AS count
       FROM security_events
       WHERE event_type = 'econ_rebalance_infeasible'`
    );

    const standardFailure = result.tierFailures.find((failure) => failure.tier === "standard");
    const premiumFailure = result.tierFailures.find((failure) => failure.tier === "premium");
    const eliteFailure = result.tierFailures.find((failure) => failure.tier === "elite");

    expect(standardFailure).toBeTruthy();
    expect(premiumFailure || eliteFailure).toBeFalsy();
    expect(Number(afterEvents.rows[0].count)).toBeGreaterThan(Number(beforeEvents.rows[0].count));
    expect(result.anchorSource).toBe("live_current_price_eligible_catalog");
    expect(typeof result.diagnosticsByTier.standard.targetEdgeBps).toBe("number");
    expect(typeof result.diagnosticsByTier.standard.achievedEdgeBps).toBe("number");
    expect(typeof result.diagnosticsByTier.standard.edgeDeltaBps).toBe("number");
    expect(typeof result.diagnosticsByTier.standard.aggressiveEdgeWarning).toBe("boolean");
  });

  it("simulate accepts per-tier overrides and returns diagnostics", async () => {
    const result = await simulateEconomicsRebalance({
      targetEdgeByTier: {
        standard: 0.3,
        premium: 0.2,
        elite: 0.1
      },
      winRateFloorByTier: {
        standard: 0.01,
        premium: 0.02,
        elite: 0.03
      }
    });

    expect(result.tiers.length).toBe(3);
    expect(result.anchorSource).toBe("live_current_price_eligible_catalog");
    expect(result.anchorSnapshotMeta.fallbackApplied).toBe(false);
    expect(result.anchorSnapshotMeta.byRarity.common.pricedCardCount).toBeGreaterThan(0);
    expect(result.anchorSnapshotMeta.byRarity.common.missingPriceCount).toBe(
      result.anchorSnapshotMeta.byRarity.common.eligibleCardCount - result.anchorSnapshotMeta.byRarity.common.pricedCardCount
    );

    for (const tier of result.tiers) {
      expect(typeof tier.targetEdge).toBe("number");
      expect(typeof tier.achievedEdge).toBe("number");
      expect(typeof tier.targetEdgeBps).toBe("number");
      expect(typeof tier.achievedEdgeBps).toBe("number");
      expect(typeof tier.edgeDeltaBps).toBe("number");
      expect(typeof tier.aggressiveEdgeWarning).toBe("boolean");
      expect(typeof tier.meanEV).toBe("number");
      expect(typeof tier.winRate).toBe("number");
      expect(typeof tier.constraintsSatisfied).toBe("boolean");
    }
  });
});
