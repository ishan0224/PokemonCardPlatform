import { createHmac } from "crypto";
import type { QueryResult, QueryResultRow } from "pg";
import {
  canonicalizeEligibleCardIdsByRarity,
  FairnessDrawError,
  generateWeightedPack,
  type HmacSha256Fn,
  type WeightedSlotDistribution
} from "../../lib/fairness/hmac-draws";
import { FAIRNESS_UNIQUE_FIRST_ATTEMPTS } from "../../lib/fairness/constants";
import { RARITY_TIERS } from "../../lib/types";
import type { PackTier, RarityTier } from "../../lib/types";
import { query } from "../db/pool";
import type { GenerationVersionPayload } from "./pack-generation-version.service";

export type GeneratedPackCard = {
  slotNumber: number;
  pokemonCardId: string;
  rarityTier: RarityTier;
  acquisitionPrice: number;
};

export type InsertedPackCard = GeneratedPackCard & {
  id: string;
};

export class CardServiceError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode = 400,
    code = "CARD_SERVICE_ERROR",
    details?: Record<string, unknown>
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
};

type PokemonCardRow = {
  id: string;
  rarity_tier: RarityTier;
  current_price: string;
};

export type SlotPlanEntry = {
  slotNumber: number;
  rarityTier: RarityTier;
  pokemonCardId: string;
};

export type GeneratePackCardsInput = {
  tier: PackTier;
  generationVersion: GenerationVersionPayload;
  serverSeedHex: string;
  clientSeedHex: string;
  nonce: bigint;
};

const nodeHmacSha256: HmacSha256Fn = async (key, message) => {
  return createHmac("sha256", Buffer.from(key)).update(Buffer.from(message)).digest();
};

function getQueryable(client?: Queryable): Queryable {
  if (client) {
    return client;
  }

  return {
    query: <T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) => query<T>(text, params)
  };
}

function ensureEligibleByRarityShape(eligible: unknown, tier: PackTier): Record<RarityTier, readonly string[]> {
  if (!eligible || typeof eligible !== "object") {
    throw new CardServiceError("Generation version payload missing eligible card IDs.", 500, "SLOT_TOPOLOGY_MISMATCH", {
      tier
    });
  }

  const typed = eligible as Partial<Record<RarityTier, unknown>>;
  const normalized = {} as Record<RarityTier, readonly string[]>;

  for (const rarity of RARITY_TIERS) {
    const entries = typed[rarity];
    if (!Array.isArray(entries)) {
      throw new CardServiceError("Generation version payload has malformed eligible card IDs.", 500, "SLOT_TOPOLOGY_MISMATCH", {
        tier,
        rarity
      });
    }
    if (!entries.every((entry) => typeof entry === "string")) {
      throw new CardServiceError("Generation version payload eligible IDs must be UUID strings.", 500, "SLOT_TOPOLOGY_MISMATCH", {
        tier,
        rarity
      });
    }
    normalized[rarity] = [...entries];
  }

  return canonicalizeEligibleCardIdsByRarity(normalized);
}

function ensureTierWeights(
  generationVersionPayload: GenerationVersionPayload,
  tier: PackTier
): { cardsPerPack: number; slots: WeightedSlotDistribution[][] } {
  const tierWeights = generationVersionPayload.weightsByTier[tier];
  if (!tierWeights) {
    throw new CardServiceError("Missing tier weights in generation version payload.", 500, "SLOT_TOPOLOGY_MISMATCH", { tier });
  }

  if (!Array.isArray(tierWeights.slots) || tierWeights.slots.length === 0) {
    throw new CardServiceError("Generation version payload has invalid slot topology.", 500, "SLOT_TOPOLOGY_MISMATCH", { tier });
  }

  if (tierWeights.cardsPerPack !== tierWeights.slots.length) {
    throw new CardServiceError("Generation version payload has slot count mismatch.", 500, "SLOT_TOPOLOGY_MISMATCH", {
      tier,
      cardsPerPack: tierWeights.cardsPerPack,
      slotCount: tierWeights.slots.length
    });
  }

  return {
    cardsPerPack: tierWeights.cardsPerPack,
    slots: tierWeights.slots as WeightedSlotDistribution[][]
  };
}

function mapFairnessError(error: unknown, tier: PackTier): CardServiceError {
  if (error instanceof CardServiceError) {
    return error;
  }

  if (error instanceof FairnessDrawError) {
    return new CardServiceError(error.message, 500, error.code, {
      tier,
      ...(error.details ?? {})
    });
  }

  return new CardServiceError(
    error instanceof Error ? error.message : "Deterministic generation failed.",
    500,
    "CARD_SERVICE_ERROR",
    { tier }
  );
}

export async function generateDeterministicSlotPlan(input: {
  tier: PackTier;
  generationVersionPayload: GenerationVersionPayload;
  serverSeedHex: string;
  clientSeedHex: string;
  nonce: bigint;
}): Promise<{ slotPlan: SlotPlanEntry[]; expectedSlotCount: number; drawCountConsumed: bigint }> {
  const tierWeights = ensureTierWeights(input.generationVersionPayload, input.tier);
  const tierEligible = input.generationVersionPayload.eligibleCardIdsByTier[input.tier];
  const eligibleByRarity = ensureEligibleByRarityShape(tierEligible, input.tier);
  try {
    const generated = await generateWeightedPack(
      {
        tier: input.tier,
        serverSeedHex: input.serverSeedHex,
        clientSeedHex: input.clientSeedHex,
        nonce: input.nonce,
        slots: tierWeights.slots,
        eligibleCardIdsByRarity: eligibleByRarity,
        enforceUniqueCards: true,
        uniqueFirstAttempts: FAIRNESS_UNIQUE_FIRST_ATTEMPTS,
        allowDuplicateFallback: true
      },
      { hmacSha256: nodeHmacSha256 }
    );

    const slotPlan = generated.cards.map((card) => ({
      slotNumber: card.slotNumber,
      rarityTier: card.rarityTier,
      pokemonCardId: card.pokemonCardId
    }));

    if (slotPlan.length !== tierWeights.cardsPerPack) {
      throw new CardServiceError("Generated slot plan length mismatch.", 500, "SLOT_TOPOLOGY_MISMATCH", {
        tier: input.tier,
        expected: tierWeights.cardsPerPack,
        actual: slotPlan.length
      });
    }

    return {
      slotPlan,
      expectedSlotCount: tierWeights.cardsPerPack,
      drawCountConsumed: generated.drawCounterConsumed
    };
  } catch (error) {
    throw mapFairnessError(error, input.tier);
  }
}

export async function generatePackCards(input: GeneratePackCardsInput): Promise<{
  slotPlan: SlotPlanEntry[];
  expectedSlotCount: number;
  drawCountConsumed: bigint;
}> {
  return generateDeterministicSlotPlan({
    tier: input.tier,
    generationVersionPayload: input.generationVersion,
    serverSeedHex: input.serverSeedHex,
    clientSeedHex: input.clientSeedHex,
    nonce: input.nonce
  });
}

export async function hydrateCardsForSlotPlan(
  slotPlan: SlotPlanEntry[],
  client?: Queryable
): Promise<Map<string, { rarityTier: RarityTier; currentPrice: number }>> {
  const q = getQueryable(client);
  const uniqueIds = Array.from(new Set(slotPlan.map((entry) => entry.pokemonCardId)));

  if (uniqueIds.length === 0) {
    return new Map();
  }

  const rows = await q.query<PokemonCardRow>(
    `SELECT id, rarity_tier, current_price
     FROM pokemon_cards
     WHERE id = ANY($1::uuid[])`,
    [uniqueIds]
  );

  const byId = new Map<string, { rarityTier: RarityTier; currentPrice: number }>();
  for (const row of rows.rows) {
    byId.set(row.id, {
      rarityTier: row.rarity_tier,
      currentPrice: Number(row.current_price)
    });
  }

  return byId;
}

export function materializeGeneratedCards(input: {
  tier: PackTier;
  slotPlan: SlotPlanEntry[];
  hydratedByCardId: Map<string, { rarityTier: RarityTier; currentPrice: number }>;
  expectedSlotCount: number;
}): GeneratedPackCard[] {
  if (input.slotPlan.length !== input.expectedSlotCount) {
    throw new CardServiceError("Generated slot plan length mismatch.", 500, "SLOT_TOPOLOGY_MISMATCH", {
      tier: input.tier,
      expected: input.expectedSlotCount,
      actual: input.slotPlan.length
    });
  }

  const uniqueCardCount = new Set(input.slotPlan.map((entry) => entry.pokemonCardId)).size;
  if (input.hydratedByCardId.size !== uniqueCardCount) {
    throw new CardServiceError("Hydrated card count does not match unique selected cards.", 500, "CARD_HYDRATION_MISMATCH", {
      tier: input.tier,
      expectedUniqueCards: uniqueCardCount,
      hydratedRows: input.hydratedByCardId.size
    });
  }

  return input.slotPlan.map((entry) => {
    const hydrated = input.hydratedByCardId.get(entry.pokemonCardId);
    if (!hydrated) {
      throw new CardServiceError("Selected card missing in hydration map.", 500, "CARD_HYDRATION_MISMATCH", {
        tier: input.tier,
        slotNumber: entry.slotNumber,
        cardId: entry.pokemonCardId
      });
    }

    if (hydrated.rarityTier !== entry.rarityTier) {
      throw new CardServiceError("Card rarity does not match planned slot rarity.", 500, "RARITY_TIER_MISMATCH", {
        tier: input.tier,
        slotNumber: entry.slotNumber,
        cardId: entry.pokemonCardId,
        expectedRarity: entry.rarityTier,
        actualRarity: hydrated.rarityTier
      });
    }

    return {
      slotNumber: entry.slotNumber,
      pokemonCardId: entry.pokemonCardId,
      rarityTier: entry.rarityTier,
      acquisitionPrice: hydrated.currentPrice
    };
  });
}

export async function insertPackCardsBulk(
  input: {
    packId: string;
    ownerId: string;
    cards: GeneratedPackCard[];
  },
  client?: Queryable
): Promise<InsertedPackCard[]> {
  if (input.cards.length === 0) {
    return [];
  }

  const q = getQueryable(client);
  const pokemonCardIds = input.cards.map((card) => card.pokemonCardId);
  const slotNumbers = input.cards.map((card) => card.slotNumber);
  const rarityTiers = input.cards.map((card) => card.rarityTier);
  const acquisitionPrices = input.cards.map((card) => card.acquisitionPrice);

  const inserted = await q.query<{
    id: string;
    pokemon_card_id: string;
    slot_number: number;
    rarity_tier: RarityTier;
    acquisition_price: string;
  }>(
    `INSERT INTO cards
       (pack_id, owner_id, pokemon_card_id, slot_number, rarity_tier, state, acquisition_price)
     SELECT $1::uuid,
            $2::uuid,
            payload.pokemon_card_id,
            payload.slot_number,
            payload.rarity_tier,
            'in_pack',
            payload.acquisition_price
     FROM UNNEST(
       $3::uuid[],
       $4::int[],
       $5::text[],
       $6::bigint[]
     ) AS payload(pokemon_card_id, slot_number, rarity_tier, acquisition_price)
     RETURNING id, pokemon_card_id, slot_number, rarity_tier, acquisition_price`,
    [input.packId, input.ownerId, pokemonCardIds, slotNumbers, rarityTiers, acquisitionPrices]
  );

  const mapped = inserted.rows.map((row) => ({
    id: row.id,
    pokemonCardId: row.pokemon_card_id,
    slotNumber: Number(row.slot_number),
    rarityTier: row.rarity_tier,
    acquisitionPrice: Number(row.acquisition_price)
  }));

  if (mapped.length !== input.cards.length) {
    throw new CardServiceError("Bulk insert row count mismatch for generated cards.", 500, "BULK_INSERT_MISMATCH", {
      expected: input.cards.length,
      actual: mapped.length
    });
  }

  mapped.sort((a, b) => a.slotNumber - b.slotNumber);
  return mapped;
}
