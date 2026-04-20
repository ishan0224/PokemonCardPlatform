import assert from "node:assert/strict";
import { PACK_TIER_CONFIGS } from "../src/server/config/pack-tiers";
import { generateDeterministicSlotPlan, materializeGeneratedCards, type SlotPlanEntry } from "../src/server/services/card.service";
import type { GenerationVersionPayload } from "../src/server/services/pack-generation-version.service";

function createTestGenerationPayload(): GenerationVersionPayload {
  const cloneTierWeights = (tier: "standard" | "premium" | "elite") => ({
    cardsPerPack: PACK_TIER_CONFIGS[tier].cardsPerPack,
    slots: PACK_TIER_CONFIGS[tier].slots.map((slot) =>
      slot.map((entry) => ({
        rarity: entry.rarity,
        weight: entry.weight
      }))
    )
  });

  const createEligibleByRarity = () => ({
    common: ["card-common-1"],
    uncommon: ["card-uncommon-1"],
    rare: ["card-rare-1"],
    holo_rare: ["card-holo-1"],
    ultra_rare: ["card-ultra-1"],
    chase: ["card-chase-1"]
  });

  return {
    weightsByTier: {
      standard: cloneTierWeights("standard"),
      premium: cloneTierWeights("premium"),
      elite: cloneTierWeights("elite")
    },
    eligibleCardIdsByTier: {
      standard: createEligibleByRarity(),
      premium: createEligibleByRarity(),
      elite: createEligibleByRarity()
    }
  };
}

function expectErrorCode(run: () => void, code: string): void {
  try {
    run();
    assert.fail(`Expected error code ${code}, but function succeeded.`);
  } catch (error) {
    const actualCode = (error as { code?: string })?.code;
    assert.equal(actualCode, code, `Expected code ${code}, got ${actualCode ?? "unknown"}.`);
  }
}

async function runDeterministicReproducibilityTest(): Promise<void> {
  const payload = createTestGenerationPayload();
  const seedInput = {
    tier: "standard" as const,
    generationVersionPayload: payload,
    serverSeedHex: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    clientSeedHex: "89abcdef0123456789abcdef01234567",
    nonce: 42n
  };

  const first = await generateDeterministicSlotPlan(seedInput);
  const second = await generateDeterministicSlotPlan(seedInput);

  assert.deepEqual(first.slotPlan, second.slotPlan, "Deterministic generation must be reproducible.");
  assert.equal(first.expectedSlotCount, second.expectedSlotCount);
}

async function runDuplicateFallbackDeterminismTest(): Promise<void> {
  const payload = createTestGenerationPayload();
  payload.eligibleCardIdsByTier.standard.common = ["only-common-card"];
  payload.eligibleCardIdsByTier.standard.uncommon = ["only-uncommon-card"];
  payload.eligibleCardIdsByTier.standard.rare = ["only-rare-card"];
  payload.eligibleCardIdsByTier.standard.holo_rare = ["only-holo-card"];

  const first = await generateDeterministicSlotPlan({
    tier: "standard",
    generationVersionPayload: payload,
    serverSeedHex: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    clientSeedHex: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    nonce: 7n
  });
  const second = await generateDeterministicSlotPlan({
    tier: "standard",
    generationVersionPayload: payload,
    serverSeedHex: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    clientSeedHex: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    nonce: 7n
  });

  assert.deepEqual(first.slotPlan, second.slotPlan, "Duplicate fallback path must still be deterministic.");
}

function runMaterializationIntegrityTests(): void {
  const slotPlan: SlotPlanEntry[] = [
    { slotNumber: 1, rarityTier: "common", pokemonCardId: "card-common-1" },
    { slotNumber: 2, rarityTier: "rare", pokemonCardId: "card-rare-1" }
  ];

  expectErrorCode(
    () =>
      materializeGeneratedCards({
        tier: "standard",
        slotPlan,
        expectedSlotCount: 3,
        hydratedByCardId: new Map([
          ["card-common-1", { rarityTier: "common", currentPrice: 10 }],
          ["card-rare-1", { rarityTier: "rare", currentPrice: 20 }]
        ])
      }),
    "SLOT_TOPOLOGY_MISMATCH"
  );

  expectErrorCode(
    () =>
      materializeGeneratedCards({
        tier: "standard",
        slotPlan,
        expectedSlotCount: 2,
        hydratedByCardId: new Map([["card-common-1", { rarityTier: "common", currentPrice: 10 }]])
      }),
    "CARD_HYDRATION_MISMATCH"
  );

  expectErrorCode(
    () =>
      materializeGeneratedCards({
        tier: "standard",
        slotPlan,
        expectedSlotCount: 2,
        hydratedByCardId: new Map([
          ["card-common-1", { rarityTier: "common", currentPrice: 10 }],
          ["card-rare-1", { rarityTier: "holo_rare", currentPrice: 20 }]
        ])
      }),
    "RARITY_TIER_MISMATCH"
  );

  const valid = materializeGeneratedCards({
    tier: "standard",
    slotPlan,
    expectedSlotCount: 2,
    hydratedByCardId: new Map([
      ["card-common-1", { rarityTier: "common", currentPrice: 10 }],
      ["card-rare-1", { rarityTier: "rare", currentPrice: 20 }]
    ])
  });

  assert.equal(valid.length, 2);
  assert.equal(valid[0].acquisitionPrice, 10);
  assert.equal(valid[1].acquisitionPrice, 20);
}

async function main(): Promise<void> {
  await runDeterministicReproducibilityTest();
  await runDuplicateFallbackDeterminismTest();
  runMaterializationIntegrityTests();
  console.log("[test:n1:unit] PASS");
}

void main();
