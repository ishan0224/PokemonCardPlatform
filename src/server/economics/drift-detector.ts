import { PACK_TIERS, RARITY_TIERS, type RarityTier } from "../../lib/types";
import type { GenerationAnchorSnapshot, GenerationEligibleIdsByTier } from "../services/pack-generation-version.service";

export type DriftPricePoint = {
  cardId: string;
  rarityTier: RarityTier;
  currentPrice: number;
};

export type AnchorDriftPerTier = {
  anchorPrice: number;
  currentMeanPrice: number;
  driftBps: number;
  sampleSize: number;
};

export type AnchorDriftResult = {
  driftBps: number;
  sampleSize: number;
  perTier: Record<RarityTier, AnchorDriftPerTier>;
};

function buildEligibleIdsByRarity(eligibleCardIds: GenerationEligibleIdsByTier): Record<RarityTier, string[]> {
  const byRarity = {} as Record<RarityTier, Set<string>>;
  for (const rarity of RARITY_TIERS) {
    byRarity[rarity] = new Set<string>();
  }

  for (const tier of PACK_TIERS) {
    for (const rarity of RARITY_TIERS) {
      for (const cardId of eligibleCardIds[tier][rarity]) {
        byRarity[rarity].add(cardId);
      }
    }
  }

  return {
    common: Array.from(byRarity.common).sort(),
    uncommon: Array.from(byRarity.uncommon).sort(),
    rare: Array.from(byRarity.rare).sort(),
    holo_rare: Array.from(byRarity.holo_rare).sort(),
    ultra_rare: Array.from(byRarity.ultra_rare).sort(),
    chase: Array.from(byRarity.chase).sort()
  };
}

function computeRelativeDriftBps(current: number, anchor: number): number {
  if (!Number.isFinite(current) || current < 0) {
    return 0;
  }

  if (!Number.isFinite(anchor) || anchor <= 0) {
    return current <= 0 ? 0 : 10_000;
  }

  return Math.round((Math.abs(current - anchor) / anchor) * 10_000);
}

export function selectEligibleCardIdsForDrift(
  eligibleCardIds: GenerationEligibleIdsByTier,
  sampleMaxCards: number
): string[] {
  const normalizedSampleMaxCards = Math.max(Math.trunc(sampleMaxCards), 1);
  const byRarity = buildEligibleIdsByRarity(eligibleCardIds);
  const allEligible = RARITY_TIERS.flatMap((rarity) => byRarity[rarity]);
  if (allEligible.length <= normalizedSampleMaxCards) {
    return allEligible;
  }

  const selected: string[] = [];
  const selectedSet = new Set<string>();
  const cursors: Record<RarityTier, number> = {
    common: 0,
    uncommon: 0,
    rare: 0,
    holo_rare: 0,
    ultra_rare: 0,
    chase: 0
  };
  const baselinePerRarity = Math.max(Math.floor(normalizedSampleMaxCards / RARITY_TIERS.length), 1);

  for (const rarity of RARITY_TIERS) {
    const pool = byRarity[rarity];
    const take = Math.min(pool.length, baselinePerRarity, normalizedSampleMaxCards - selected.length);
    for (let index = 0; index < take; index += 1) {
      selected.push(pool[index]);
      selectedSet.add(pool[index]);
    }
    cursors[rarity] = take;
  }

  while (selected.length < normalizedSampleMaxCards) {
    let addedInRound = false;
    for (const rarity of RARITY_TIERS) {
      if (selected.length >= normalizedSampleMaxCards) {
        break;
      }

      const pool = byRarity[rarity];
      while (cursors[rarity] < pool.length && selectedSet.has(pool[cursors[rarity]])) {
        cursors[rarity] += 1;
      }
      if (cursors[rarity] >= pool.length) {
        continue;
      }

      const nextId = pool[cursors[rarity]];
      selected.push(nextId);
      selectedSet.add(nextId);
      cursors[rarity] += 1;
      addedInRound = true;
    }

    if (!addedInRound) {
      break;
    }
  }

  return selected;
}

export function computeAnchorDriftBps(input: {
  currentPrices: DriftPricePoint[];
  anchorSnapshot: GenerationAnchorSnapshot;
  eligibleCardIds: GenerationEligibleIdsByTier;
}): AnchorDriftResult {
  const eligibleByRarity = buildEligibleIdsByRarity(input.eligibleCardIds);
  const eligibleSetsByRarity: Record<RarityTier, Set<string>> = {
    common: new Set(eligibleByRarity.common),
    uncommon: new Set(eligibleByRarity.uncommon),
    rare: new Set(eligibleByRarity.rare),
    holo_rare: new Set(eligibleByRarity.holo_rare),
    ultra_rare: new Set(eligibleByRarity.ultra_rare),
    chase: new Set(eligibleByRarity.chase)
  };
  const sumsByRarity = {
    common: 0,
    uncommon: 0,
    rare: 0,
    holo_rare: 0,
    ultra_rare: 0,
    chase: 0
  } satisfies Record<RarityTier, number>;
  const countsByRarity = {
    common: 0,
    uncommon: 0,
    rare: 0,
    holo_rare: 0,
    ultra_rare: 0,
    chase: 0
  } satisfies Record<RarityTier, number>;

  for (const point of input.currentPrices) {
    if (!eligibleSetsByRarity[point.rarityTier].has(point.cardId)) {
      continue;
    }
    if (!Number.isFinite(point.currentPrice) || point.currentPrice < 0) {
      continue;
    }

    sumsByRarity[point.rarityTier] += point.currentPrice;
    countsByRarity[point.rarityTier] += 1;
  }

  const perTier = {} as Record<RarityTier, AnchorDriftPerTier>;
  let totalWeightedDrift = 0;
  let sampleSize = 0;

  for (const rarity of RARITY_TIERS) {
    const count = countsByRarity[rarity];
    const anchorPrice = Number(input.anchorSnapshot[rarity] ?? 0);
    const currentMeanPrice = count > 0 ? sumsByRarity[rarity] / count : 0;
    const driftBps = count > 0 ? computeRelativeDriftBps(currentMeanPrice, anchorPrice) : 0;

    perTier[rarity] = {
      anchorPrice,
      currentMeanPrice,
      driftBps,
      sampleSize: count
    };

    sampleSize += count;
    totalWeightedDrift += driftBps * count;
  }

  return {
    driftBps: sampleSize > 0 ? Math.round(totalWeightedDrift / sampleSize) : 0,
    sampleSize,
    perTier
  };
}
