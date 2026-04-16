import type { PackTier, PackTierConfig } from "../../lib/types";
import { PACK_PRICE_CENTS } from "./constants";

export const PACK_TIER_CONFIGS: Record<PackTier, PackTierConfig> = {
  standard: {
    tier: "standard",
    displayName: "Standard",
    priceCents: PACK_PRICE_CENTS.standard,
    cardsPerPack: 5,
    slots: [
      [{ rarity: "common", weight: 1.0 }],
      [{ rarity: "common", weight: 1.0 }],
      [{ rarity: "uncommon", weight: 1.0 }],
      [
        { rarity: "uncommon", weight: 0.8 },
        { rarity: "rare", weight: 0.2 }
      ],
      [
        { rarity: "rare", weight: 0.5 },
        { rarity: "holo_rare", weight: 0.4 },
        { rarity: "ultra_rare", weight: 0.1 }
      ]
    ]
  },
  premium: {
    tier: "premium",
    displayName: "Premium",
    priceCents: PACK_PRICE_CENTS.premium,
    cardsPerPack: 7,
    slots: [
      [{ rarity: "common", weight: 1.0 }],
      [{ rarity: "uncommon", weight: 1.0 }],
      [{ rarity: "uncommon", weight: 1.0 }],
      [{ rarity: "rare", weight: 1.0 }],
      [
        { rarity: "rare", weight: 0.6 },
        { rarity: "holo_rare", weight: 0.4 }
      ],
      [
        { rarity: "holo_rare", weight: 0.82 },
        { rarity: "ultra_rare", weight: 0.18 }
      ],
      [
        { rarity: "holo_rare", weight: 0.52 },
        { rarity: "ultra_rare", weight: 0.45 },
        { rarity: "chase", weight: 0.03 }
      ]
    ]
  },
  elite: {
    tier: "elite",
    displayName: "Elite",
    priceCents: PACK_PRICE_CENTS.elite,
    cardsPerPack: 10,
    slots: [
      [{ rarity: "common", weight: 1.0 }],
      [{ rarity: "uncommon", weight: 1.0 }],
      [{ rarity: "uncommon", weight: 1.0 }],
      [{ rarity: "rare", weight: 1.0 }],
      [{ rarity: "rare", weight: 1.0 }],
      [
        { rarity: "rare", weight: 0.5 },
        { rarity: "holo_rare", weight: 0.5 }
      ],
      [{ rarity: "holo_rare", weight: 1.0 }],
      [
        { rarity: "holo_rare", weight: 0.8 },
        { rarity: "ultra_rare", weight: 0.2 }
      ],
      [
        { rarity: "holo_rare", weight: 0.7 },
        { rarity: "ultra_rare", weight: 0.28 },
        { rarity: "chase", weight: 0.02 }
      ],
      [
        { rarity: "ultra_rare", weight: 0.7 },
        { rarity: "chase", weight: 0.3 }
      ]
    ]
  }
};

export const PACK_TIERS: PackTier[] = ["standard", "premium", "elite"];

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
