import { describe, expect, it } from "vitest";
import { PACK_TIERS, type PackTier, type RarityTier } from "../../../lib/types";
import { solveWeights, type SolverBounds, type SolverTierInput } from "../weight-solver";

const TEST_BOUNDS: SolverBounds = {
  globalWeightMin: 0,
  globalWeightMax: 1,
  rarityFloorByTier: {},
  rarityCapByTier: {},
  featureOutlierPriceMultiplier: 2,
  monteCarloSamples: 2_000,
  optimizationStep: 0.01,
  optimizationMaxIterations: 2_000
};

function buildTierInput(overrides: Partial<SolverTierInput> = {}): SolverTierInput {
  return {
    tier: overrides.tier ?? "standard",
    packPriceCents: overrides.packPriceCents ?? 100,
    targetEdge: overrides.targetEdge ?? 0.2,
    winRateFloor: overrides.winRateFloor ?? 0,
    slots: overrides.slots ?? [
      [{ rarity: "common", weight: 1 }],
      [{ rarity: "uncommon", weight: 1 }],
      [{ rarity: "rare", weight: 1 }]
    ],
    rarityPricePools: overrides.rarityPricePools ?? {
      common: [8, 10, 12],
      uncommon: [15, 18, 22],
      rare: [26, 32, 38],
      holo_rare: [45, 50, 60],
      ultra_rare: [80, 95, 120],
      chase: [170, 220, 260]
    },
    featureSlotIndexes: overrides.featureSlotIndexes ?? [2]
  };
}

function buildSolverInput(overridesByTier?: Partial<Record<PackTier, Partial<SolverTierInput>>>) {
  const tiers = {} as Record<PackTier, SolverTierInput>;

  for (const tier of PACK_TIERS) {
    tiers[tier] = buildTierInput({
      tier,
      ...(overridesByTier?.[tier] ?? {})
    });
  }

  return {
    tiers,
    bounds: TEST_BOUNDS
  };
}

describe("weight solver referenced-rarity validation", () => {
  it("fails when a referenced rarity pool is empty", () => {
    const pools: Record<RarityTier, number[]> = {
      common: [10],
      uncommon: [20],
      rare: [],
      holo_rare: [40],
      ultra_rare: [80],
      chase: [160]
    };

    const result = solveWeights(
      buildSolverInput({
        standard: {
          rarityPricePools: pools
        },
        premium: {
          rarityPricePools: pools
        },
        elite: {
          rarityPricePools: pools
        }
      })
    );

    const failure = result.resultsByTier.standard.failure;
    expect(failure?.code).toBe("EMPTY_RARITY_POOL");
    expect(failure?.details?.rarity).toBe("rare");
  });

  it("passes when only non-referenced rarity pools are empty", () => {
    const pools: Record<RarityTier, number[]> = {
      common: [10],
      uncommon: [20],
      rare: [30],
      holo_rare: [],
      ultra_rare: [],
      chase: []
    };

    const result = solveWeights(
      buildSolverInput({
        standard: {
          rarityPricePools: pools
        },
        premium: {
          rarityPricePools: pools
        },
        elite: {
          rarityPricePools: pools
        }
      })
    );

    expect(result.resultsByTier.standard.failure).toBeNull();
    expect(result.resultsByTier.standard.diagnostics.distribution.meanEV).toBeGreaterThan(0);
    expect(result.resultsByTier.standard.diagnostics.feasibilityPassed).toBe(true);
  });

  it("passes with populated referenced pools and normal optimization", () => {
    const result = solveWeights(buildSolverInput());

    expect(result.resultsByTier.standard.failure).toBeNull();
    expect(result.resultsByTier.standard.diagnostics.optimizationPassed).toBe(true);
    expect(result.resultsByTier.standard.diagnostics.distribution.p50).toBeGreaterThan(0);
  });
});
