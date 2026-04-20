import type { PackTier, RarityTier, SlotDistribution } from "../../lib/types";
import { PACK_TIERS } from "../../lib/types";
import { PACK_PRICE_CENTS, TARGET_HOUSE_EDGE_BPS } from "../config/constants";
import type { GenerationAnchorSnapshot, GenerationWeightsByTier } from "../services/pack-generation-version.service";

export type Phase0BootstrapSolverInput = {
  anchorSnapshot: GenerationAnchorSnapshot;
  baseWeightsByTier: GenerationWeightsByTier;
};

export type Phase0BootstrapSolverTierDiagnostics = {
  tier: PackTier;
  packPriceCents: number;
  targetHouseEdgeBps: number;
  targetEvCents: number;
  baselineEvCents: number;
  solvedEvCents: number;
  rarityCompressionGamma: number;
  targetAchieved: boolean;
  targetGapCents: number;
};

export type Phase0BootstrapSolverOutput = {
  solvedWeightsByTier: GenerationWeightsByTier;
  diagnosticsByTier: Record<PackTier, Phase0BootstrapSolverTierDiagnostics>;
};

function chooseCheapestRarity(slot: SlotDistribution[], anchors: GenerationAnchorSnapshot): RarityTier {
  let cheapest = slot[0].rarity;
  let cheapestAnchor = anchors[cheapest];

  for (const entry of slot.slice(1)) {
    const anchor = anchors[entry.rarity];
    if (anchor < cheapestAnchor) {
      cheapest = entry.rarity;
      cheapestAnchor = anchor;
      continue;
    }

    if (anchor === cheapestAnchor && entry.rarity < cheapest) {
      cheapest = entry.rarity;
      cheapestAnchor = anchor;
    }
  }

  return cheapest;
}

function applyCompressionToSlot(
  slot: SlotDistribution[],
  anchors: GenerationAnchorSnapshot,
  gamma: number
): SlotDistribution[] {
  if (slot.length <= 1) {
    return slot.map((entry) => ({ ...entry }));
  }

  const cheapest = chooseCheapestRarity(slot, anchors);

  let nonCheapestTotal = 0;
  const provisional = slot.map((entry) => {
    if (entry.rarity === cheapest) {
      return { rarity: entry.rarity, weight: 0 };
    }

    const scaled = entry.weight * gamma;
    nonCheapestTotal += scaled;
    return { rarity: entry.rarity, weight: scaled };
  });

  const cheapestWeight = Math.max(0, 1 - nonCheapestTotal);

  return provisional.map((entry) => {
    if (entry.rarity === cheapest) {
      return { rarity: entry.rarity, weight: cheapestWeight };
    }
    return entry;
  });
}

function calculateSlotEv(slot: SlotDistribution[], anchors: GenerationAnchorSnapshot): number {
  return slot.reduce((sum, entry) => sum + entry.weight * anchors[entry.rarity], 0);
}

function calculateTierEv(slots: SlotDistribution[][], anchors: GenerationAnchorSnapshot): number {
  return slots.reduce((sum, slot) => sum + calculateSlotEv(slot, anchors), 0);
}

function solveTierSlots(input: {
  tier: PackTier;
  slots: SlotDistribution[][];
  anchors: GenerationAnchorSnapshot;
  targetEvCents: number;
}): {
  solvedSlots: SlotDistribution[][];
  solvedEvCents: number;
  gamma: number;
  baselineEvCents: number;
  targetAchieved: boolean;
} {
  const baselineEv = calculateTierEv(input.slots, input.anchors);
  if (baselineEv <= input.targetEvCents) {
    return {
      solvedSlots: input.slots.map((slot) => slot.map((entry) => ({ ...entry }))),
      solvedEvCents: baselineEv,
      gamma: 1,
      baselineEvCents: baselineEv,
      targetAchieved: true
    };
  }

  const lowerBoundSlots = input.slots.map((slot) => applyCompressionToSlot(slot, input.anchors, 0));
  const lowerBoundEv = calculateTierEv(lowerBoundSlots, input.anchors);

  if (lowerBoundEv > input.targetEvCents) {
    return {
      solvedSlots: lowerBoundSlots,
      solvedEvCents: lowerBoundEv,
      gamma: 0,
      baselineEvCents: baselineEv,
      targetAchieved: false
    };
  }

  let lo = 0;
  let hi = 1;
  let bestGamma = 0;
  let bestSlots = lowerBoundSlots;
  let bestEv = lowerBoundEv;

  for (let iteration = 0; iteration < 40; iteration += 1) {
    const mid = (lo + hi) / 2;
    const candidateSlots = input.slots.map((slot) => applyCompressionToSlot(slot, input.anchors, mid));
    const candidateEv = calculateTierEv(candidateSlots, input.anchors);

    if (candidateEv <= input.targetEvCents) {
      bestGamma = mid;
      bestSlots = candidateSlots;
      bestEv = candidateEv;
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return {
    solvedSlots: bestSlots,
    solvedEvCents: bestEv,
    gamma: bestGamma,
    baselineEvCents: baselineEv,
    targetAchieved: true
  };
}

export function solvePhase0BootstrapGeneration(input: Phase0BootstrapSolverInput): Phase0BootstrapSolverOutput {
  const solved = {} as GenerationWeightsByTier;
  const diagnosticsByTier = {} as Record<PackTier, Phase0BootstrapSolverTierDiagnostics>;

  for (const tier of PACK_TIERS) {
    const baselineTier = input.baseWeightsByTier[tier];
    const packPrice = PACK_PRICE_CENTS[tier];
    const targetEdgeBps = TARGET_HOUSE_EDGE_BPS[tier];
    const targetEv = packPrice * (1 - targetEdgeBps / 10_000);

    const solvedTier = solveTierSlots({
      tier,
      slots: baselineTier.slots,
      anchors: input.anchorSnapshot,
      targetEvCents: targetEv
    });

    solved[tier] = {
      cardsPerPack: baselineTier.cardsPerPack,
      slots: solvedTier.solvedSlots
    };

    diagnosticsByTier[tier] = {
      tier,
      packPriceCents: packPrice,
      targetHouseEdgeBps: targetEdgeBps,
      targetEvCents: targetEv,
      baselineEvCents: solvedTier.baselineEvCents,
      solvedEvCents: solvedTier.solvedEvCents,
      rarityCompressionGamma: solvedTier.gamma,
      targetAchieved: solvedTier.targetAchieved,
      targetGapCents: solvedTier.solvedEvCents - targetEv
    };
  }

  return {
    solvedWeightsByTier: solved,
    diagnosticsByTier
  };
}
