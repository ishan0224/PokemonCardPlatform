import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import type { PackTier, RarityTier } from "../../lib/types";
import { PACK_TIER_CONFIGS } from "../config/pack-tiers";
import { query } from "../db/pool";

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

function getQueryable(client?: Queryable): Queryable {
  if (client) {
    return client;
  }

  return {
    query: <T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) => query<T>(text, params)
  };
}

function rollSlotRarity(slotDistribution: Array<{ rarity: RarityTier; weight: number }>): RarityTier {
  const roll = Math.random();
  let cumulative = 0;

  for (const { rarity, weight } of slotDistribution) {
    cumulative += weight;

    if (roll < cumulative) {
      return rarity;
    }
  }

  return slotDistribution[slotDistribution.length - 1].rarity;
}

async function pickUniqueRandomCardForRarity(
  rarityTier: RarityTier,
  excludedCardIds: string[],
  client?: Queryable
): Promise<PokemonCardRow | null> {
  const q = getQueryable(client);

  const preferred = await q.query<PokemonCardRow>(
    `SELECT id, rarity_tier, current_price
     FROM pokemon_cards
     WHERE rarity_tier = $1
       AND (cardinality($2::uuid[]) = 0 OR id <> ALL($2::uuid[]))
     ORDER BY random()
     LIMIT 1`,
    [rarityTier, excludedCardIds]
  );

  if (preferred.rowCount && preferred.rowCount > 0) {
    return preferred.rows[0];
  }

  return null;
}

async function pickAnyRandomCardForRarity(
  rarityTier: RarityTier,
  client?: Queryable
): Promise<PokemonCardRow | null> {
  const q = getQueryable(client);
  const fallback = await q.query<PokemonCardRow>(
    `SELECT id, rarity_tier, current_price
     FROM pokemon_cards
     WHERE rarity_tier = $1
     ORDER BY random()
     LIMIT 1`,
    [rarityTier]
  );

  return fallback.rowCount && fallback.rowCount > 0 ? fallback.rows[0] : null;
}

export async function generatePackCards(tier: PackTier, client?: PoolClient): Promise<GeneratedPackCard[]> {
  const config = PACK_TIER_CONFIGS[tier];

  if (!config) {
    throw new CardServiceError("Unsupported pack tier.", 400, "INVALID_PACK_TIER", { tier });
  }

  const generated: GeneratedPackCard[] = [];
  const usedCardIds = new Set<string>();

  for (let slotIndex = 0; slotIndex < config.slots.length; slotIndex += 1) {
    const slot = config.slots[slotIndex];
    const rarity = rollSlotRarity(slot);

    let selected: PokemonCardRow | null = null;

    // HLD behavior: try up to 3 times to avoid duplicates within the same pack.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      selected = await pickUniqueRandomCardForRarity(rarity, [...usedCardIds], client);

      if (selected) {
        break;
      }
    }

    // If unique selection is exhausted, allow a duplicate fallback.
    if (!selected) {
      selected = await pickAnyRandomCardForRarity(rarity, client);
    }

    if (!selected) {
      throw new CardServiceError("Card catalog does not have enough cards for required rarity.", 500, "CATALOG_INSUFFICIENT", {
        tier,
        slot: slotIndex + 1,
        rarity
      });
    }

    usedCardIds.add(selected.id);

    generated.push({
      slotNumber: slotIndex + 1,
      pokemonCardId: selected.id,
      rarityTier: selected.rarity_tier,
      acquisitionPrice: Number(selected.current_price)
    });
  }

  return generated;
}

export async function insertPackCards(
  input: {
    packId: string;
    ownerId: string;
    cards: GeneratedPackCard[];
  },
  client?: PoolClient
): Promise<InsertedPackCard[]> {
  const q = getQueryable(client);
  const inserted: InsertedPackCard[] = [];

  for (const card of input.cards) {
    const result = await q.query<{ id: string }>(
      `INSERT INTO cards
         (pack_id, owner_id, pokemon_card_id, slot_number, rarity_tier, state, acquisition_price)
       VALUES ($1, $2, $3, $4, $5, 'in_pack', $6)
       RETURNING id`,
      [input.packId, input.ownerId, card.pokemonCardId, card.slotNumber, card.rarityTier, card.acquisitionPrice]
    );

    inserted.push({
      id: result.rows[0].id,
      ...card
    });
  }

  return inserted;
}
