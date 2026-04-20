import { PACK_TIERS as PACK_TIERS_ORDER } from "../../lib/types";
import type { PackTier, PackTierConfig } from "../../lib/types";
import { PACK_PRICE_CENTS } from "./constants";

export const PACK_TIER_CONFIGS: Record<PackTier, PackTierConfig> = {
  standard: {
    tier: "standard",
    displayName: "Standard",
    priceCents: PACK_PRICE_CENTS.standard,
    cardsPerPack: 3,
    slots: [
      [{ rarity: "common", weight: 1.0 }],
      [{ rarity: "common", weight: 1.0 }],
      [
        { rarity: "uncommon", weight: 0.9 },
        { rarity: "rare", weight: 0.1 }
      ]
    ]
  },
  premium: {
    tier: "premium",
    displayName: "Premium",
    priceCents: PACK_PRICE_CENTS.premium,
    cardsPerPack: 4,
    slots: [
      [{ rarity: "common", weight: 1.0 }],
      [{ rarity: "uncommon", weight: 1.0 }],
      [{ rarity: "uncommon", weight: 1.0 }],
      [
        { rarity: "rare", weight: 0.9 },
        { rarity: "ultra_rare", weight: 0.1 }
      ]
    ]
  },
  elite: {
    tier: "elite",
    displayName: "Elite",
    priceCents: PACK_PRICE_CENTS.elite,
    cardsPerPack: 5,
    slots: [
      [{ rarity: "common", weight: 1.0 }],
      [{ rarity: "uncommon", weight: 1.0 }],
      [{ rarity: "rare", weight: 1.0 }],
      [{ rarity: "rare", weight: 1.0 }],
      [
        { rarity: "rare", weight: 0.9 },
        { rarity: "ultra_rare", weight: 0.1 }
      ]
    ]
  }
};

export const PACK_TIERS: PackTier[] = [...PACK_TIERS_ORDER];

function validatePackTierConfigs(): void {
  for (const tier of PACK_TIERS) {
    const config = PACK_TIER_CONFIGS[tier];

    if (config.cardsPerPack !== config.slots.length) {
      throw new Error(
        `Invalid pack tier config for ${tier}: cardsPerPack (${config.cardsPerPack}) must match slot count (${config.slots.length}).`
      );
    }

    config.slots.forEach((slot, slotIndex) => {
      const total = slot.reduce((sum, current) => sum + current.weight, 0);
      const hasInvalidWeight = slot.some((entry) => entry.weight <= 0);

      if (hasInvalidWeight) {
        throw new Error(`Invalid pack tier config for ${tier}, slot ${slotIndex + 1}: weights must be > 0.`);
      }

      if (Math.abs(total - 1) > 0.0001) {
        throw new Error(
          `Invalid pack tier config for ${tier}, slot ${slotIndex + 1}: weights must sum to 1. Received ${total}.`
        );
      }
    });
  }
}

validatePackTierConfigs();
