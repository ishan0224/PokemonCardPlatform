import { PACK_TIERS } from "../../lib/types";
import type { PackTier, RarityTier, SlotDistribution } from "../../lib/types";

const EPSILON = 1e-9;

export type SolverBounds = {
  globalWeightMin: number;
  globalWeightMax: number;
  rarityFloorByTier: Partial<Record<RarityTier, number>>;
  rarityCapByTier: Partial<Record<RarityTier, number>>;
  featureOutlierPriceMultiplier: number;
  monteCarloSamples: number;
  optimizationStep: number;
  optimizationMaxIterations: number;
};

export type SolverTierInput = {
  tier: PackTier;
  packPriceCents: number;
  slots: SlotDistribution[][];
  rarityPricePools: Record<RarityTier, number[]>;
  targetEdge: number;
  winRateFloor: number;
  featureSlotIndexes?: number[];
};

export type WeightSolverInput = {
  tiers: Record<PackTier, SolverTierInput>;
  bounds: SolverBounds;
};

export type SolverConstraintKey =
  | "pack_price_positive"
  | "slot_topology_valid"
  | "rarity_pool_non_empty"
  | "feature_slot_non_empty"
  | "weight_bounds_feasible"
  | "slot_probability_sum"
  | "target_edge"
  | "win_rate_floor";

export type SolverTierFailureCode =
  | "INFEASIBLE_WITHIN_BOUNDS"
  | "INVALID_BOUNDS"
  | "EMPTY_RARITY_POOL"
  | "EMPTY_SLOT_AFTER_FILTER"
  | "INVALID_SLOT_TOPOLOGY"
  | "INVALID_PACK_PRICE";

export type SolverGapDiagnostics = {
  edgeGap: number;
  winRateGap: number;
  feasibilityDistance: number;
};

export type SolverTierFailure = {
  tier: PackTier;
  stage: "feasibility" | "optimization";
  code: SolverTierFailureCode;
  message: string;
  violatedConstraints: SolverConstraintKey[];
  nearestFeasibleGap: SolverGapDiagnostics;
  details?: Record<string, unknown>;
};

export type SolverDistribution = {
  meanEV: number;
  stdDev: number;
  p10: number;
  p50: number;
  p90: number;
  winRate: number;
  projectedMarginOver1000Packs: number;
};

export type SolverTierDiagnostics = {
  tier: PackTier;
  packPriceCents: number;
  targetEdge: number;
  achievedEdge: number;
  targetAchieved: boolean;
  winRateFloor: number;
  winRateAchieved: boolean;
  constraintsSatisfied: boolean;
  iterations: number;
  distribution: SolverDistribution;
  feasibilityPassed: boolean;
  optimizationPassed: boolean;
  violatedConstraints: SolverConstraintKey[];
  nearestFeasibleGap: SolverGapDiagnostics;
};

export type SolverTierResult = {
  tier: PackTier;
  solvedSlots: SlotDistribution[][];
  diagnostics: SolverTierDiagnostics;
  failure: SolverTierFailure | null;
};

export type WeightSolverOutput = {
  resultsByTier: Record<PackTier, SolverTierResult>;
};

type RarityBound = {
  floor: number;
  cap: number;
};

type DistributionSample = {
  ev: number;
  win: boolean;
};

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(upper, Math.max(lower, value));
}

function cloneSlots(slots: SlotDistribution[][]): SlotDistribution[][] {
  return slots.map((slot) => slot.map((entry) => ({ rarity: entry.rarity, weight: entry.weight })));
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createDeterministicRng(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) {
    state = 0x9e3779b9;
  }

  return (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function toQuantile(sorted: number[], percentile: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const normalized = clamp(percentile, 0, 1);
  const idx = Math.floor((sorted.length - 1) * normalized);
  return sorted[idx];
}

function weightedPick<T>(rng: () => number, entries: readonly { weight: number; value: T }[]): T {
  const roll = rng();
  let cumulative = 0;

  for (const entry of entries) {
    cumulative += entry.weight;
    if (roll <= cumulative + EPSILON) {
      return entry.value;
    }
  }

  return entries[entries.length - 1].value;
}

function makeZeroDistribution(packPriceCents: number): SolverDistribution {
  return {
    meanEV: 0,
    stdDev: 0,
    p10: 0,
    p50: 0,
    p90: 0,
    winRate: 0,
    projectedMarginOver1000Packs: packPriceCents * 1000
  };
}

function makeGapDiagnostics(input: {
  targetEdge: number;
  achievedEdge: number;
  winRateFloor: number;
  achievedWinRate: number;
  feasibilityDistance?: number;
}): SolverGapDiagnostics {
  return {
    edgeGap: Math.max(0, input.targetEdge - input.achievedEdge),
    winRateGap: Math.max(0, input.winRateFloor - input.achievedWinRate),
    feasibilityDistance: Math.max(0, input.feasibilityDistance ?? 0)
  };
}

function makeFailure(input: {
  tier: PackTier;
  stage: "feasibility" | "optimization";
  code: SolverTierFailureCode;
  message: string;
  violatedConstraints: SolverConstraintKey[];
  targetEdge: number;
  achievedEdge: number;
  winRateFloor: number;
  achievedWinRate: number;
  feasibilityDistance?: number;
  details?: Record<string, unknown>;
}): SolverTierFailure {
  return {
    tier: input.tier,
    stage: input.stage,
    code: input.code,
    message: input.message,
    violatedConstraints: input.violatedConstraints,
    nearestFeasibleGap: makeGapDiagnostics({
      targetEdge: input.targetEdge,
      achievedEdge: input.achievedEdge,
      winRateFloor: input.winRateFloor,
      achievedWinRate: input.achievedWinRate,
      feasibilityDistance: input.feasibilityDistance
    }),
    details: input.details
  };
}

function buildDiagnostics(input: {
  tier: PackTier;
  packPriceCents: number;
  targetEdge: number;
  achievedEdge: number;
  winRateFloor: number;
  achievedWinRate: number;
  constraintsSatisfied: boolean;
  iterations: number;
  distribution: SolverDistribution;
  feasibilityPassed: boolean;
  optimizationPassed: boolean;
  violatedConstraints: SolverConstraintKey[];
  feasibilityDistance?: number;
}): SolverTierDiagnostics {
  return {
    tier: input.tier,
    packPriceCents: input.packPriceCents,
    targetEdge: input.targetEdge,
    achievedEdge: input.achievedEdge,
    targetAchieved: input.achievedEdge + EPSILON >= input.targetEdge,
    winRateFloor: input.winRateFloor,
    winRateAchieved: input.achievedWinRate + EPSILON >= input.winRateFloor,
    constraintsSatisfied: input.constraintsSatisfied,
    iterations: input.iterations,
    distribution: input.distribution,
    feasibilityPassed: input.feasibilityPassed,
    optimizationPassed: input.optimizationPassed,
    violatedConstraints: input.violatedConstraints,
    nearestFeasibleGap: makeGapDiagnostics({
      targetEdge: input.targetEdge,
      achievedEdge: input.achievedEdge,
      winRateFloor: input.winRateFloor,
      achievedWinRate: input.achievedWinRate,
      feasibilityDistance: input.feasibilityDistance
    })
  };
}

function buildRarityBounds(bounds: SolverBounds): Record<RarityTier, RarityBound> {
  const rarities: RarityTier[] = ["common", "uncommon", "rare", "holo_rare", "ultra_rare", "chase"];
  const mapped = {} as Record<RarityTier, RarityBound>;

  for (const rarity of rarities) {
    const floor = clamp(bounds.rarityFloorByTier[rarity] ?? 0, bounds.globalWeightMin, bounds.globalWeightMax);
    const cap = clamp(bounds.rarityCapByTier[rarity] ?? 1, bounds.globalWeightMin, bounds.globalWeightMax);
    mapped[rarity] = { floor, cap };
  }

  return mapped;
}

function validateTierInput(input: SolverTierInput, bounds: SolverBounds): SolverTierFailure | null {
  if (!Number.isFinite(input.packPriceCents) || input.packPriceCents <= 0) {
    return makeFailure({
      tier: input.tier,
      stage: "feasibility",
      code: "INVALID_PACK_PRICE",
      message: "Pack price must be a positive number.",
      violatedConstraints: ["pack_price_positive"],
      targetEdge: input.targetEdge,
      achievedEdge: 0,
      winRateFloor: input.winRateFloor,
      achievedWinRate: 0,
      details: { packPriceCents: input.packPriceCents }
    });
  }

  if (!Array.isArray(input.slots) || input.slots.length === 0 || input.slots.some((slot) => !Array.isArray(slot) || slot.length === 0)) {
    return makeFailure({
      tier: input.tier,
      stage: "feasibility",
      code: "INVALID_SLOT_TOPOLOGY",
      message: "Tier slots are required and each slot must be non-empty.",
      violatedConstraints: ["slot_topology_valid"],
      targetEdge: input.targetEdge,
      achievedEdge: 0,
      winRateFloor: input.winRateFloor,
      achievedWinRate: 0
    });
  }

  if (
    !Number.isFinite(bounds.globalWeightMin) ||
    !Number.isFinite(bounds.globalWeightMax) ||
    bounds.globalWeightMin < 0 ||
    bounds.globalWeightMax > 1 ||
    bounds.globalWeightMin > bounds.globalWeightMax
  ) {
    return makeFailure({
      tier: input.tier,
      stage: "feasibility",
      code: "INVALID_BOUNDS",
      message: "Global weight bounds are invalid.",
      violatedConstraints: ["weight_bounds_feasible"],
      targetEdge: input.targetEdge,
      achievedEdge: 0,
      winRateFloor: input.winRateFloor,
      achievedWinRate: 0,
      details: {
        globalWeightMin: bounds.globalWeightMin,
        globalWeightMax: bounds.globalWeightMax
      }
    });
  }

  return null;
}

function buildEffectiveRarityPools(input: SolverTierInput, bounds: SolverBounds): {
  effectivePools: Record<RarityTier, number[]>;
  failure: SolverTierFailure | null;
} {
  const effectivePools = {
    common: [...(input.rarityPricePools.common ?? [])],
    uncommon: [...(input.rarityPricePools.uncommon ?? [])],
    rare: [...(input.rarityPricePools.rare ?? [])],
    holo_rare: [...(input.rarityPricePools.holo_rare ?? [])],
    ultra_rare: [...(input.rarityPricePools.ultra_rare ?? [])],
    chase: [...(input.rarityPricePools.chase ?? [])]
  } satisfies Record<RarityTier, number[]>;

  const referencedRarities = new Set<RarityTier>();
  for (const slot of input.slots) {
    for (const entry of slot) {
      if (entry.weight > 0) {
        referencedRarities.add(entry.rarity);
      }
    }
  }

  for (const rarity of referencedRarities) {
    if (effectivePools[rarity].length === 0) {
      return {
        effectivePools,
        failure: makeFailure({
          tier: input.tier,
          stage: "feasibility",
          code: "EMPTY_RARITY_POOL",
          message: "At least one rarity pool is empty.",
          violatedConstraints: ["rarity_pool_non_empty"],
          targetEdge: input.targetEdge,
          achievedEdge: 0,
          winRateFloor: input.winRateFloor,
          achievedWinRate: 0,
          details: { rarity }
        })
      };
    }
  }

  const featureSlots = input.featureSlotIndexes && input.featureSlotIndexes.length > 0
    ? input.featureSlotIndexes
    : [input.slots.length - 1];

  const featureRarities = new Set<RarityTier>();
  for (const slotIndex of featureSlots) {
    const slot = input.slots[slotIndex];
    if (!slot || slot.length === 0) {
      return {
        effectivePools,
        failure: makeFailure({
          tier: input.tier,
          stage: "feasibility",
          code: "EMPTY_SLOT_AFTER_FILTER",
          message: "Configured feature slot index does not map to a valid slot.",
          violatedConstraints: ["feature_slot_non_empty"],
          targetEdge: input.targetEdge,
          achievedEdge: 0,
          winRateFloor: input.winRateFloor,
          achievedWinRate: 0,
          details: { slotIndex }
        })
      };
    }

    for (const entry of slot) {
      featureRarities.add(entry.rarity);
    }
  }

  const outlierCutoff = input.packPriceCents * bounds.featureOutlierPriceMultiplier;
  for (const rarity of featureRarities) {
    const filtered = effectivePools[rarity].filter((price) => price <= outlierCutoff);
    if (filtered.length > 0) {
      effectivePools[rarity] = filtered;
    }
  }

  return { effectivePools, failure: null };
}

function normalizeSlotWithBounds(
  slot: SlotDistribution[],
  means: Record<RarityTier, number>,
  rarityBounds: Record<RarityTier, RarityBound>
): { slot: SlotDistribution[]; infeasible: boolean; residualDistance: number } {
  const working = slot.map((entry) => {
    const bound = rarityBounds[entry.rarity];
    return {
      rarity: entry.rarity,
      weight: clamp(entry.weight, bound.floor, bound.cap)
    };
  });

  const sum = working.reduce((acc, entry) => acc + entry.weight, 0);
  let delta = 1 - sum;

  if (Math.abs(delta) > EPSILON) {
    if (delta > 0) {
      const ranked = [...working].sort((a, b) => means[a.rarity] - means[b.rarity]);
      for (const target of ranked) {
        if (delta <= EPSILON) {
          break;
        }

        const bound = rarityBounds[target.rarity];
        const headroom = bound.cap - target.weight;
        if (headroom <= EPSILON) {
          continue;
        }

        const add = Math.min(delta, headroom);
        target.weight += add;
        delta -= add;
      }
    } else {
      let overflow = Math.abs(delta);
      const ranked = [...working].sort((a, b) => means[b.rarity] - means[a.rarity]);
      for (const target of ranked) {
        if (overflow <= EPSILON) {
          break;
        }

        const bound = rarityBounds[target.rarity];
        const removable = target.weight - bound.floor;
        if (removable <= EPSILON) {
          continue;
        }

        const remove = Math.min(overflow, removable);
        target.weight -= remove;
        overflow -= remove;
      }
      delta = -overflow;
    }
  }

  const finalSum = working.reduce((acc, entry) => acc + entry.weight, 0);
  const residualDistance = Math.abs(1 - finalSum);

  if (residualDistance > 1e-6) {
    return {
      slot: working,
      infeasible: true,
      residualDistance
    };
  }

  return {
    slot: working,
    infeasible: false,
    residualDistance
  };
}

function computeTierEv(slots: SlotDistribution[][], means: Record<RarityTier, number>): number {
  let ev = 0;
  for (const slot of slots) {
    for (const entry of slot) {
      ev += entry.weight * means[entry.rarity];
    }
  }
  return ev;
}

function chooseOptimizationMove(input: {
  slots: SlotDistribution[][];
  means: Record<RarityTier, number>;
  bounds: Record<RarityTier, RarityBound>;
  step: number;
}): { slotIndex: number; fromIndex: number; toIndex: number; delta: number; improvement: number } | null {
  let best: { slotIndex: number; fromIndex: number; toIndex: number; delta: number; improvement: number } | null = null;

  for (let slotIndex = 0; slotIndex < input.slots.length; slotIndex += 1) {
    const slot = input.slots[slotIndex];

    for (let fromIndex = 0; fromIndex < slot.length; fromIndex += 1) {
      const from = slot[fromIndex];
      const fromBound = input.bounds[from.rarity];
      const removable = from.weight - fromBound.floor;
      if (removable <= EPSILON) {
        continue;
      }

      for (let toIndex = 0; toIndex < slot.length; toIndex += 1) {
        if (toIndex === fromIndex) {
          continue;
        }

        const to = slot[toIndex];
        const toBound = input.bounds[to.rarity];
        const addable = toBound.cap - to.weight;
        if (addable <= EPSILON) {
          continue;
        }

        const slope = input.means[from.rarity] - input.means[to.rarity];
        if (slope <= EPSILON) {
          continue;
        }

        const delta = Math.min(input.step, removable, addable);
        if (delta <= EPSILON) {
          continue;
        }

        const improvement = slope * delta;
        if (!best || improvement > best.improvement) {
          best = { slotIndex, fromIndex, toIndex, delta, improvement };
        }
      }
    }
  }

  return best;
}

function createSimulationSeed(input: {
  tier: PackTier;
  packPriceCents: number;
  sampleCount: number;
  slots: SlotDistribution[][];
  means: Record<RarityTier, number>;
}): number {
  const canonical = JSON.stringify({
    tier: input.tier,
    packPriceCents: input.packPriceCents,
    sampleCount: input.sampleCount,
    slots: input.slots,
    means: input.means
  });
  return hashString(canonical);
}

function runMonteCarlo(input: {
  tier: PackTier;
  slots: SlotDistribution[][];
  rarityPricePools: Record<RarityTier, number[]>;
  rarityMeans: Record<RarityTier, number>;
  packPriceCents: number;
  sampleCount: number;
}): SolverDistribution {
  const seed = createSimulationSeed({
    tier: input.tier,
    packPriceCents: input.packPriceCents,
    sampleCount: input.sampleCount,
    slots: input.slots,
    means: input.rarityMeans
  });

  const rng = createDeterministicRng(seed);
  const samples: DistributionSample[] = [];

  for (let sample = 0; sample < input.sampleCount; sample += 1) {
    let packValue = 0;

    for (const slot of input.slots) {
      const rarity = weightedPick(
        rng,
        slot.map((entry) => ({ value: entry.rarity, weight: entry.weight }))
      );

      const pool = input.rarityPricePools[rarity];
      const index = Math.floor(rng() * pool.length);
      packValue += pool[index] ?? pool[pool.length - 1] ?? 0;
    }

    samples.push({
      ev: packValue,
      win: packValue >= input.packPriceCents
    });
  }

  const values = samples.map((entry) => entry.ev).sort((a, b) => a - b);
  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  const stdDev = Math.sqrt(variance);
  const wins = samples.reduce((count, sample) => count + (sample.win ? 1 : 0), 0);

  return {
    meanEV: mean,
    stdDev,
    p10: toQuantile(values, 0.1),
    p50: toQuantile(values, 0.5),
    p90: toQuantile(values, 0.9),
    winRate: wins / input.sampleCount,
    projectedMarginOver1000Packs: (input.packPriceCents - mean) * 1000
  };
}

function solveTier(input: { tier: SolverTierInput; bounds: SolverBounds }): SolverTierResult {
  const baselineSlots = cloneSlots(input.tier.slots);
  const validationFailure = validateTierInput(input.tier, input.bounds);

  if (validationFailure) {
    return {
      tier: input.tier.tier,
      solvedSlots: baselineSlots,
      diagnostics: buildDiagnostics({
        tier: input.tier.tier,
        packPriceCents: input.tier.packPriceCents,
        targetEdge: input.tier.targetEdge,
        achievedEdge: 0,
        winRateFloor: input.tier.winRateFloor,
        achievedWinRate: 0,
        constraintsSatisfied: false,
        iterations: 0,
        distribution: makeZeroDistribution(input.tier.packPriceCents),
        feasibilityPassed: false,
        optimizationPassed: false,
        violatedConstraints: validationFailure.violatedConstraints,
        feasibilityDistance: validationFailure.nearestFeasibleGap.feasibilityDistance
      }),
      failure: validationFailure
    };
  }

  const effectivePoolsResult = buildEffectiveRarityPools(input.tier, input.bounds);
  if (effectivePoolsResult.failure) {
    return {
      tier: input.tier.tier,
      solvedSlots: baselineSlots,
      diagnostics: buildDiagnostics({
        tier: input.tier.tier,
        packPriceCents: input.tier.packPriceCents,
        targetEdge: input.tier.targetEdge,
        achievedEdge: 0,
        winRateFloor: input.tier.winRateFloor,
        achievedWinRate: 0,
        constraintsSatisfied: false,
        iterations: 0,
        distribution: makeZeroDistribution(input.tier.packPriceCents),
        feasibilityPassed: false,
        optimizationPassed: false,
        violatedConstraints: effectivePoolsResult.failure.violatedConstraints,
        feasibilityDistance: effectivePoolsResult.failure.nearestFeasibleGap.feasibilityDistance
      }),
      failure: effectivePoolsResult.failure
    };
  }

  const means: Record<RarityTier, number> = {
    common: average(effectivePoolsResult.effectivePools.common),
    uncommon: average(effectivePoolsResult.effectivePools.uncommon),
    rare: average(effectivePoolsResult.effectivePools.rare),
    holo_rare: average(effectivePoolsResult.effectivePools.holo_rare),
    ultra_rare: average(effectivePoolsResult.effectivePools.ultra_rare),
    chase: average(effectivePoolsResult.effectivePools.chase)
  };

  const rarityBounds = buildRarityBounds(input.bounds);

  // Stage 1: Feasibility pass.
  const feasibleSlots = cloneSlots(input.tier.slots);
  let feasibilityDistance = 0;

  for (let slotIndex = 0; slotIndex < feasibleSlots.length; slotIndex += 1) {
    const normalized = normalizeSlotWithBounds(feasibleSlots[slotIndex], means, rarityBounds);
    feasibleSlots[slotIndex] = normalized.slot;
    feasibilityDistance = Math.max(feasibilityDistance, normalized.residualDistance);

    if (normalized.infeasible) {
      const failure = makeFailure({
        tier: input.tier.tier,
        stage: "feasibility",
        code: "INFEASIBLE_WITHIN_BOUNDS",
        message: "Stage-1 feasibility failed while normalizing slot probabilities.",
        violatedConstraints: ["slot_probability_sum", "weight_bounds_feasible"],
        targetEdge: input.tier.targetEdge,
        achievedEdge: 0,
        winRateFloor: input.tier.winRateFloor,
        achievedWinRate: 0,
        feasibilityDistance,
        details: { slotIndex }
      });

      return {
        tier: input.tier.tier,
        solvedSlots: baselineSlots,
        diagnostics: buildDiagnostics({
          tier: input.tier.tier,
          packPriceCents: input.tier.packPriceCents,
          targetEdge: input.tier.targetEdge,
          achievedEdge: 0,
          winRateFloor: input.tier.winRateFloor,
          achievedWinRate: 0,
          constraintsSatisfied: false,
          iterations: 0,
          distribution: makeZeroDistribution(input.tier.packPriceCents),
          feasibilityPassed: false,
          optimizationPassed: false,
          violatedConstraints: failure.violatedConstraints,
          feasibilityDistance
        }),
        failure
      };
    }
  }

  // Stage 2: Objective optimization while staying feasible.
  const optimizedSlots = cloneSlots(feasibleSlots);
  const targetEv = input.tier.packPriceCents * (1 - input.tier.targetEdge);
  let currentEv = computeTierEv(optimizedSlots, means);
  let iterations = 0;

  while (currentEv - targetEv > 1e-6 && iterations < input.bounds.optimizationMaxIterations) {
    const move = chooseOptimizationMove({
      slots: optimizedSlots,
      means,
      bounds: rarityBounds,
      step: input.bounds.optimizationStep
    });

    if (!move) {
      break;
    }

    const slot = optimizedSlots[move.slotIndex];
    slot[move.fromIndex].weight -= move.delta;
    slot[move.toIndex].weight += move.delta;

    iterations += 1;
    currentEv -= move.improvement;
  }

  for (let slotIndex = 0; slotIndex < optimizedSlots.length; slotIndex += 1) {
    const normalized = normalizeSlotWithBounds(optimizedSlots[slotIndex], means, rarityBounds);
    optimizedSlots[slotIndex] = normalized.slot;
    feasibilityDistance = Math.max(feasibilityDistance, normalized.residualDistance);
  }

  const distribution = runMonteCarlo({
    tier: input.tier.tier,
    slots: optimizedSlots,
    rarityPricePools: effectivePoolsResult.effectivePools,
    rarityMeans: means,
    packPriceCents: input.tier.packPriceCents,
    sampleCount: input.bounds.monteCarloSamples
  });

  const achievedEdge = 1 - distribution.meanEV / input.tier.packPriceCents;
  const targetAchieved = achievedEdge + EPSILON >= input.tier.targetEdge;
  const winRateAchieved = distribution.winRate + EPSILON >= input.tier.winRateFloor;

  const violatedConstraints: SolverConstraintKey[] = [];
  if (!targetAchieved) {
    violatedConstraints.push("target_edge");
  }
  if (!winRateAchieved) {
    violatedConstraints.push("win_rate_floor");
  }

  if (violatedConstraints.length > 0) {
    const failure = makeFailure({
      tier: input.tier.tier,
      stage: "optimization",
      code: "INFEASIBLE_WITHIN_BOUNDS",
      message: "Stage-2 optimization could not satisfy target edge/win-rate within hard bounds.",
      violatedConstraints,
      targetEdge: input.tier.targetEdge,
      achievedEdge,
      winRateFloor: input.tier.winRateFloor,
      achievedWinRate: distribution.winRate,
      feasibilityDistance,
      details: {
        targetEv,
        achievedEv: distribution.meanEV,
        iterations,
        maxIterations: input.bounds.optimizationMaxIterations
      }
    });

    return {
      tier: input.tier.tier,
      solvedSlots: baselineSlots,
      diagnostics: buildDiagnostics({
        tier: input.tier.tier,
        packPriceCents: input.tier.packPriceCents,
        targetEdge: input.tier.targetEdge,
        achievedEdge,
        winRateFloor: input.tier.winRateFloor,
        achievedWinRate: distribution.winRate,
        constraintsSatisfied: false,
        iterations,
        distribution,
        feasibilityPassed: true,
        optimizationPassed: false,
        violatedConstraints,
        feasibilityDistance
      }),
      failure
    };
  }

  return {
    tier: input.tier.tier,
    solvedSlots: optimizedSlots,
    diagnostics: buildDiagnostics({
      tier: input.tier.tier,
      packPriceCents: input.tier.packPriceCents,
      targetEdge: input.tier.targetEdge,
      achievedEdge,
      winRateFloor: input.tier.winRateFloor,
      achievedWinRate: distribution.winRate,
      constraintsSatisfied: true,
      iterations,
      distribution,
      feasibilityPassed: true,
      optimizationPassed: true,
      violatedConstraints: [],
      feasibilityDistance
    }),
    failure: null
  };
}

export function solveWeights(input: WeightSolverInput): WeightSolverOutput {
  const resultsByTier = {} as Record<PackTier, SolverTierResult>;

  for (const tier of PACK_TIERS) {
    const tierInput = input.tiers[tier];
    resultsByTier[tier] = solveTier({ tier: tierInput, bounds: input.bounds });
  }

  return { resultsByTier };
}
