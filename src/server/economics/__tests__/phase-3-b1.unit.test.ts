import { describe, expect, it } from "vitest";
import { ApiRouteError } from "../../http/api";
import { parseEconomicsKnobs } from "../knobs-validation";
import { computeEconomicsContentHash } from "../rebalance";
import { solveWeights, type SolverBounds, type SolverTierInput } from "../weight-solver";
import { PACK_PRICE_CENTS, TARGET_HOUSE_EDGE_BPS } from "../../config/constants";
import { PACK_TIER_CONFIGS } from "../../config/pack-tiers";
import type {
  GenerationAnchorSnapshot,
  GenerationEligibleIdsByTier,
  GenerationWeightsByTier
} from "../../services/pack-generation-version.service";
import { PACK_TIERS, type PackTier, type RarityTier } from "../../../lib/types";

const BASE_BOUNDS: SolverBounds = {
  globalWeightMin: 0,
  globalWeightMax: 1,
  rarityFloorByTier: {
    common: 0.02,
    uncommon: 0.01
  },
  rarityCapByTier: {
    ultra_rare: 0.35,
    chase: 0.2
  },
  featureOutlierPriceMultiplier: 1.5,
  monteCarloSamples: 10_000,
  optimizationStep: 0.01,
  optimizationMaxIterations: 10_000
};

function buildTierInput(overrides: Partial<SolverTierInput> = {}): SolverTierInput {
  return {
    tier: overrides.tier ?? "standard",
    packPriceCents: overrides.packPriceCents ?? 100,
    targetEdge: overrides.targetEdge ?? 0.2,
    winRateFloor: overrides.winRateFloor ?? 0,
    slots: overrides.slots ?? [
      [{ rarity: "common", weight: 1 }],
      [
        { rarity: "common", weight: 0.7 },
        { rarity: "uncommon", weight: 0.3 }
      ],
      [
        { rarity: "rare", weight: 0.85 },
        { rarity: "ultra_rare", weight: 0.15 }
      ]
    ],
    rarityPricePools: overrides.rarityPricePools ?? {
      common: [5, 8, 10],
      uncommon: [12, 16, 20],
      rare: [24, 30, 36],
      holo_rare: [40, 52, 60],
      ultra_rare: [75, 90, 120],
      chase: [180, 220, 260]
    },
    featureSlotIndexes: overrides.featureSlotIndexes ?? [2]
  };
}

function buildSolverInput(overrideByTier?: Partial<Record<PackTier, Partial<SolverTierInput>>>) {
  const tiers = {} as Record<PackTier, SolverTierInput>;
  for (const tier of PACK_TIERS) {
    tiers[tier] = buildTierInput({
      tier,
      ...(overrideByTier?.[tier] ?? {})
    });
  }

  return {
    tiers,
    bounds: BASE_BOUNDS
  };
}

describe("Phase 3 B1 solver unit", () => {
  it("respects configured bounds", () => {
    const result = solveWeights(buildSolverInput());

    for (const tier of PACK_TIERS) {
      const tierResult = result.resultsByTier[tier];
      expect(tierResult.failure).toBeNull();

      for (const slot of tierResult.solvedSlots) {
        const slotSum = slot.reduce((sum, entry) => sum + entry.weight, 0);
        expect(Math.abs(slotSum - 1)).toBeLessThan(1e-6);

        for (const entry of slot) {
          const floor = BASE_BOUNDS.rarityFloorByTier[entry.rarity] ?? BASE_BOUNDS.globalWeightMin;
          const cap = BASE_BOUNDS.rarityCapByTier[entry.rarity] ?? BASE_BOUNDS.globalWeightMax;

          expect(entry.weight).toBeGreaterThanOrEqual(floor - 1e-6);
          expect(entry.weight).toBeLessThanOrEqual(cap + 1e-6);
        }
      }
    }
  });

  it("handles one-card pools", () => {
    const oneCardPools: Record<RarityTier, number[]> = {
      common: [9],
      uncommon: [14],
      rare: [21],
      holo_rare: [34],
      ultra_rare: [55],
      chase: [89]
    };

    const result = solveWeights(
      buildSolverInput({
        standard: {
          rarityPricePools: oneCardPools,
          packPriceCents: 120,
          targetEdge: 0.25
        },
        premium: {
          rarityPricePools: oneCardPools,
          packPriceCents: 120,
          targetEdge: 0.25
        },
        elite: {
          rarityPricePools: oneCardPools,
          packPriceCents: 120,
          targetEdge: 0.25
        }
      })
    );

    for (const tier of PACK_TIERS) {
      expect(result.resultsByTier[tier].failure).toBeNull();
      expect(result.resultsByTier[tier].diagnostics.distribution.p50).toBeGreaterThan(0);
    }
  });

  it("excludes pathological outliers from feature slot path", () => {
    const outlierPools: Record<RarityTier, number[]> = {
      common: [5],
      uncommon: [8],
      rare: [20],
      holo_rare: [25],
      ultra_rare: [60, 1_000],
      chase: [90, 2_000]
    };

    const result = solveWeights(
      buildSolverInput({
        standard: {
          slots: [
            [{ rarity: "common", weight: 1 }],
            [{ rarity: "uncommon", weight: 1 }],
            [
              { rarity: "ultra_rare", weight: 0.5 },
              { rarity: "chase", weight: 0.5 }
            ]
          ],
          rarityPricePools: outlierPools,
          packPriceCents: 100,
          targetEdge: 0.1
        },
        premium: {
          rarityPricePools: outlierPools,
          packPriceCents: 100,
          targetEdge: 0.1
        },
        elite: {
          rarityPricePools: outlierPools,
          packPriceCents: 100,
          targetEdge: 0.1
        }
      })
    );

    const diagnostics = result.resultsByTier.standard.diagnostics;
    expect(diagnostics.distribution.meanEV).toBeLessThan(300);
  });

  it("is idempotent for content hash with same solver outputs", () => {
    const weightsByTier: GenerationWeightsByTier = {
      standard: { cardsPerPack: 3, slots: buildTierInput({ tier: "standard" }).slots },
      premium: { cardsPerPack: 3, slots: buildTierInput({ tier: "premium" }).slots },
      elite: { cardsPerPack: 3, slots: buildTierInput({ tier: "elite" }).slots }
    };

    const eligibleCardIdsByTier: GenerationEligibleIdsByTier = {
      standard: {
        common: ["00000000-0000-0000-0000-000000000001"],
        uncommon: ["00000000-0000-0000-0000-000000000002"],
        rare: ["00000000-0000-0000-0000-000000000003"],
        holo_rare: ["00000000-0000-0000-0000-000000000004"],
        ultra_rare: ["00000000-0000-0000-0000-000000000005"],
        chase: ["00000000-0000-0000-0000-000000000006"]
      },
      premium: {
        common: ["00000000-0000-0000-0000-000000000001"],
        uncommon: ["00000000-0000-0000-0000-000000000002"],
        rare: ["00000000-0000-0000-0000-000000000003"],
        holo_rare: ["00000000-0000-0000-0000-000000000004"],
        ultra_rare: ["00000000-0000-0000-0000-000000000005"],
        chase: ["00000000-0000-0000-0000-000000000006"]
      },
      elite: {
        common: ["00000000-0000-0000-0000-000000000001"],
        uncommon: ["00000000-0000-0000-0000-000000000002"],
        rare: ["00000000-0000-0000-0000-000000000003"],
        holo_rare: ["00000000-0000-0000-0000-000000000004"],
        ultra_rare: ["00000000-0000-0000-0000-000000000005"],
        chase: ["00000000-0000-0000-0000-000000000006"]
      }
    };

    const anchorSnapshot: GenerationAnchorSnapshot = {
      common: 5,
      uncommon: 10,
      rare: 20,
      holo_rare: 40,
      ultra_rare: 80,
      chase: 160
    };

    const hashA = computeEconomicsContentHash({
      algorithmVersion: "pack-gen-v2-deterministic",
      weightsByTier,
      eligibleCardIdsByTier,
      anchorSnapshot
    });

    const hashB = computeEconomicsContentHash({
      algorithmVersion: "pack-gen-v2-deterministic",
      weightsByTier,
      eligibleCardIdsByTier,
      anchorSnapshot
    });

    expect(hashA).toBe(hashB);
  });
});

describe("Phase 3 route input contract", () => {
  it("accepts per-tier overrides", () => {
    const parsed = parseEconomicsKnobs({
      anchorScale: 1.2,
      ultraRareMaxWeight: 0.2,
      chaseMaxWeight: 0.1,
      targetEdgeByTier: {
        standard: 0.3,
        premium: 0.2
      },
      winRateFloorByTier: {
        standard: 0.05,
        elite: 0.01
      }
    });

    expect(parsed.targetEdgeByTier?.standard).toBe(0.3);
    expect(parsed.winRateFloorByTier?.elite).toBe(0.01);
  });

  it("rejects malformed tier keys", () => {
    expect(() =>
      parseEconomicsKnobs({
        targetEdgeByTier: {
          invalid_tier: 0.2
        }
      })
    ).toThrowError(ApiRouteError);
  });

  it("rejects out-of-range per-tier override values", () => {
    expect(() =>
      parseEconomicsKnobs({
        targetEdgeByTier: {
          standard: 1
        }
      })
    ).toThrowError(ApiRouteError);

    expect(() =>
      parseEconomicsKnobs({
        winRateFloorByTier: {
          premium: -0.1
        }
      })
    ).toThrowError(ApiRouteError);
  });

  it("rejects unsupported top-level fields", () => {
    expect(() =>
      parseEconomicsKnobs({
        anchorScale: 1,
        unsupportedField: 123
      })
    ).toThrowError(ApiRouteError);
  });
});

describe("Business design v2 alignment", () => {
  it("uses business-designv2 pack prices and target edge constants", () => {
    expect(PACK_PRICE_CENTS.standard).toBe(2499);
    expect(PACK_PRICE_CENTS.premium).toBe(8999);
    expect(PACK_PRICE_CENTS.elite).toBe(18999);

    expect(TARGET_HOUSE_EDGE_BPS.standard).toBe(3090);
    expect(TARGET_HOUSE_EDGE_BPS.premium).toBe(2089);
    expect(TARGET_HOUSE_EDGE_BPS.elite).toBe(1699);
  });

  it("uses business-designv2 slot topology by tier", () => {
    expect(PACK_TIER_CONFIGS.standard.cardsPerPack).toBe(3);
    expect(PACK_TIER_CONFIGS.standard.slots).toEqual([
      [{ rarity: "common", weight: 1 }],
      [{ rarity: "common", weight: 1 }],
      [
        { rarity: "uncommon", weight: 0.9 },
        { rarity: "rare", weight: 0.1 }
      ]
    ]);

    expect(PACK_TIER_CONFIGS.premium.cardsPerPack).toBe(4);
    expect(PACK_TIER_CONFIGS.premium.slots).toEqual([
      [{ rarity: "common", weight: 1 }],
      [{ rarity: "uncommon", weight: 1 }],
      [{ rarity: "uncommon", weight: 1 }],
      [
        { rarity: "rare", weight: 0.9 },
        { rarity: "ultra_rare", weight: 0.1 }
      ]
    ]);

    expect(PACK_TIER_CONFIGS.elite.cardsPerPack).toBe(5);
    expect(PACK_TIER_CONFIGS.elite.slots).toEqual([
      [{ rarity: "common", weight: 1 }],
      [{ rarity: "uncommon", weight: 1 }],
      [{ rarity: "rare", weight: 1 }],
      [{ rarity: "rare", weight: 1 }],
      [
        { rarity: "rare", weight: 0.9 },
        { rarity: "ultra_rare", weight: 0.1 }
      ]
    ]);
  });
});
