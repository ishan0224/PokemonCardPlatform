import { PRICE_CACHE_TTL_SECONDS } from "../config/constants";
import {
  getPokemonCardPriceCacheMany,
  setPokemonCardPriceCache,
  type PokemonCardPriceCacheValue
} from "../redis/client";
import { query } from "../db/pool";
import { RARITY_TIERS } from "../../lib/types";
import type {
  CardState,
  CollectionCardTransaction,
  CollectionCardTransactionType,
  PackTier,
  RarityTier
} from "../../lib/types";

export type CollectionSort = "newest" | "value_desc" | "value_asc" | "pnl_desc" | "pnl_asc";

export type CollectionCardView = {
  id: string;
  packId: string | null;
  ownerId: string;
  slotNumber: number;
  state: CardState;
  acquisitionPrice: number;
  currentPrice: number;
  pnl: number;
  createdAt: string;
  activeListing: {
    id: string;
    price: number;
  } | null;
  pokemonCard: {
    id: string;
    tcgId: string;
    name: string;
    setName: string;
    rarity: string;
    rarityTier: RarityTier;
    imageUrl: string | null;
    imageUrlHires: string | null;
  };
};

export type CollectionPortfolioView = {
  totalCards: number;
  totalAcquisitionValue: number;
  totalMarketValue: number;
  totalPnl: number;
  byRarity: Array<{
    rarityTier: RarityTier;
    count: number;
    marketValue: number;
  }>;
};

export type CollectionListResult = {
  cards: CollectionCardView[];
  page: number;
  limit: number;
  total: number;
};

export type CollectionCardDetailView = CollectionCardView & {
  pnlPercent: number;
  previousPrice: number;
  acquiredAtIso: string;
  activeAuctionId: string | null;
  lineage: {
    packId: string | null;
    packTier: PackTier | null;
    dropId: string | null;
    dropName: string | null;
  };
  transactions: CollectionCardTransaction[];
};

const COLLECTION_SORT_SQL: Record<CollectionSort, string> = {
  newest: "c.created_at DESC",
  value_desc: "pc.current_price DESC, c.created_at DESC",
  value_asc: "pc.current_price ASC, c.created_at DESC",
  pnl_desc: "(pc.current_price - c.acquisition_price) DESC, c.created_at DESC",
  pnl_asc: "(pc.current_price - c.acquisition_price) ASC, c.created_at DESC"
};

const RARITY_ORDER: readonly RarityTier[] = [...RARITY_TIERS];

type CollectionRow = {
  card_id: string;
  pack_id: string | null;
  owner_id: string;
  slot_number: number;
  state: CardState;
  acquisition_price: string;
  created_at: string;
  listing_id: string | null;
  listing_price: string | null;
  pokemon_card_id: string;
  tcg_id: string;
  name: string;
  set_name: string;
  rarity: string;
  rarity_tier: RarityTier;
  image_url: string | null;
  image_url_hires: string | null;
};

type CollectionDetailRow = CollectionRow & {
  pack_tier: PackTier | null;
  drop_id: string | null;
  drop_name: string | null;
  active_auction_id: string | null;
};

type CollectionTransactionRow = {
  id: string;
  type: CollectionCardTransactionType;
  amount: string;
  created_at: string;
};

type PortfolioCardRow = {
  acquisition_price: string;
  pokemon_card_id: string;
  rarity_tier: RarityTier;
};

type PokemonCardPriceRow = {
  id: string;
  current_price: string;
  previous_price: string;
  last_price_update: string | null;
};

function toMoneyCents(value: string | number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(Math.trunc(parsed), 0);
}

function toSignedMoneyCents(value: string | number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.trunc(parsed);
}

function buildPriceFallbackMap(rows: PokemonCardPriceRow[]): Map<string, PokemonCardPriceCacheValue> {
  const fallbackMap = new Map<string, PokemonCardPriceCacheValue>();

  for (const row of rows) {
    if (fallbackMap.has(row.id)) {
      continue;
    }

    fallbackMap.set(row.id, {
      currentPrice: toMoneyCents(row.current_price),
      previousPrice: toMoneyCents(row.previous_price),
      updatedAt: row.last_price_update ?? new Date().toISOString()
    });
  }

  return fallbackMap;
}

function toEpochMs(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function resolveReadThroughPrices(pokemonCardIds: string[]): Promise<Map<string, PokemonCardPriceCacheValue>> {
  const resolved = new Map<string, PokemonCardPriceCacheValue>();
  if (pokemonCardIds.length === 0) {
    return resolved;
  }

  const uniqueIds = Array.from(new Set(pokemonCardIds));
  const cachedMap = await getPokemonCardPriceCacheMany(uniqueIds);
  const fallbackRows = await query<PokemonCardPriceRow>(
    `SELECT id, current_price, previous_price, last_price_update
     FROM pokemon_cards
     WHERE id = ANY($1::uuid[])`,
    [uniqueIds]
  );
  const fallbackMap = buildPriceFallbackMap(fallbackRows.rows);
  const fallbackLastUpdateById = new Map<string, number | null>();

  for (const row of fallbackRows.rows) {
    fallbackLastUpdateById.set(row.id, toEpochMs(row.last_price_update));
  }

  const cacheFillOps: Array<Promise<void>> = [];
  for (const pokemonCardId of uniqueIds) {
    const cached = cachedMap.get(pokemonCardId);
    const fallback = fallbackMap.get(pokemonCardId);

    if (!fallback) {
      if (cached) {
        resolved.set(pokemonCardId, cached);
      }
      continue;
    }

    if (!cached) {
      resolved.set(pokemonCardId, fallback);
      cacheFillOps.push(setPokemonCardPriceCache(pokemonCardId, fallback, PRICE_CACHE_TTL_SECONDS));
      continue;
    }

    const fallbackUpdatedAt = fallbackLastUpdateById.get(pokemonCardId) ?? null;
    const cachedUpdatedAt = toEpochMs(cached.updatedAt);
    const cacheValuesMismatch =
      cached.currentPrice !== fallback.currentPrice || cached.previousPrice !== fallback.previousPrice;
    const cacheIsOlderThanDb =
      fallbackUpdatedAt !== null && (cachedUpdatedAt === null || cachedUpdatedAt < fallbackUpdatedAt);

    if (cacheValuesMismatch || cacheIsOlderThanDb) {
      resolved.set(pokemonCardId, fallback);
      cacheFillOps.push(setPokemonCardPriceCache(pokemonCardId, fallback, PRICE_CACHE_TTL_SECONDS));
      continue;
    }

    resolved.set(pokemonCardId, cached);
  }

  await Promise.allSettled(cacheFillOps);
  return resolved;
}

function mapCollectionRow(row: CollectionRow, currentPrice: number): CollectionCardView {
  const acquisitionPrice = toMoneyCents(row.acquisition_price);

  return {
    id: row.card_id,
    packId: row.pack_id,
    ownerId: row.owner_id,
    slotNumber: row.slot_number,
    state: row.state,
    acquisitionPrice,
    currentPrice,
    pnl: currentPrice - acquisitionPrice,
    createdAt: row.created_at,
    activeListing:
      row.listing_id && row.listing_price !== null
        ? {
            id: row.listing_id,
            price: toMoneyCents(row.listing_price)
          }
        : null,
    pokemonCard: {
      id: row.pokemon_card_id,
      tcgId: row.tcg_id,
      name: row.name,
      setName: row.set_name,
      rarity: row.rarity,
      rarityTier: row.rarity_tier,
      imageUrl: row.image_url,
      imageUrlHires: row.image_url_hires
    }
  };
}

function mapCollectionTransactionRow(row: CollectionTransactionRow): CollectionCardTransaction {
  return {
    id: row.id,
    type: row.type,
    amount: toSignedMoneyCents(row.amount),
    createdAtIso: row.created_at
  };
}

export async function listCollectionCards(input: {
  userId: string;
  rarity?: RarityTier | null;
  state?: CardState | null;
  sort?: CollectionSort;
  page?: number;
  limit?: number;
}): Promise<CollectionListResult> {
  const page = Math.max(Math.trunc(input.page ?? 1), 1);
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 24), 1), 100);
  const sort = input.sort ?? "newest";
  const offset = (page - 1) * limit;
  const orderBySql = COLLECTION_SORT_SQL[sort] ?? COLLECTION_SORT_SQL.newest;
  const rarityFilter = input.rarity ?? null;
  const stateFilter = input.state ?? null;

  const totalResult = await query<{ total: string }>(
    `SELECT COUNT(*)::BIGINT AS total
     FROM cards c
     JOIN pokemon_cards pc ON pc.id = c.pokemon_card_id
     WHERE c.owner_id = $1
       AND c.state <> 'in_pack'
       AND ($2::text IS NULL OR c.state = $2::text)
       AND ($3::text IS NULL OR pc.rarity_tier = $3::text)`,
    [input.userId, stateFilter, rarityFilter]
  );

  const result = await query<CollectionRow>(
    `SELECT c.id AS card_id,
            c.pack_id,
            c.owner_id,
            c.slot_number,
            c.state,
            c.acquisition_price,
            c.created_at,
            l.id AS listing_id,
            l.price AS listing_price,
            pc.id AS pokemon_card_id,
            pc.tcg_id,
            pc.name,
            pc.set_name,
            pc.rarity,
            pc.rarity_tier,
            pc.image_url,
            pc.image_url_hires
     FROM cards c
     JOIN pokemon_cards pc ON pc.id = c.pokemon_card_id
     LEFT JOIN listings l
            ON l.card_id = c.id
           AND l.status = 'active'
     WHERE c.owner_id = $1
       AND c.state <> 'in_pack'
       AND ($2::text IS NULL OR c.state = $2::text)
       AND ($3::text IS NULL OR pc.rarity_tier = $3::text)
     ORDER BY ${orderBySql}
     LIMIT $4
     OFFSET $5`,
    [input.userId, stateFilter, rarityFilter, limit, offset]
  );

  const resolvedPrices = await resolveReadThroughPrices(result.rows.map((row) => row.pokemon_card_id));
  const cards = result.rows.map((row) => {
    const resolved = resolvedPrices.get(row.pokemon_card_id);
    const currentPrice = resolved ? resolved.currentPrice : 0;
    return mapCollectionRow(row, currentPrice);
  });

  return {
    cards,
    page,
    limit,
    total: Number(totalResult.rows[0]?.total ?? 0)
  };
}

export async function getCollectionCardDetail(input: {
  userId: string;
  cardId: string;
}): Promise<CollectionCardDetailView | null> {
  const cardResult = await query<CollectionDetailRow>(
    `SELECT c.id AS card_id,
            c.pack_id,
            c.owner_id,
            c.slot_number,
            c.state,
            c.acquisition_price,
            c.created_at,
            l.id AS listing_id,
            l.price AS listing_price,
            pc.id AS pokemon_card_id,
            pc.tcg_id,
            pc.name,
            pc.set_name,
            pc.rarity,
            pc.rarity_tier,
            pc.image_url,
            pc.image_url_hires,
            p.tier AS pack_tier,
            d.id AS drop_id,
            d.name AS drop_name,
            a.id AS active_auction_id
     FROM cards c
     JOIN pokemon_cards pc ON pc.id = c.pokemon_card_id
     LEFT JOIN listings l
            ON l.card_id = c.id
           AND l.status = 'active'
     LEFT JOIN packs p ON p.id = c.pack_id
     LEFT JOIN drop_packs dp ON dp.id = p.drop_pack_id
     LEFT JOIN drops d ON d.id = dp.drop_id
     LEFT JOIN auctions a
            ON a.card_id = c.id
           AND a.status = 'active'
     WHERE c.id = $1
       AND c.owner_id = $2
       AND c.state <> 'in_pack'
     LIMIT 1`,
    [input.cardId, input.userId]
  );

  if (cardResult.rowCount !== 1) {
    return null;
  }

  const cardRow = cardResult.rows[0];
  const resolvedPrices = await resolveReadThroughPrices([cardRow.pokemon_card_id]);
  const resolvedPrice = resolvedPrices.get(cardRow.pokemon_card_id);
  const currentPrice = resolvedPrice ? resolvedPrice.currentPrice : 0;
  const previousPrice = resolvedPrice ? resolvedPrice.previousPrice : 0;
  const baseCard = mapCollectionRow(cardRow, currentPrice);
  const acquisitionPrice = baseCard.acquisitionPrice;

  const transactionsResult = await query<CollectionTransactionRow>(
    `WITH listing_refs AS (
       SELECT id
       FROM listings
       WHERE card_id = $3
     ),
     auction_refs AS (
       SELECT id
       FROM auctions
       WHERE card_id = $3
     )
     SELECT id, type, amount, created_at
     FROM transactions
     WHERE user_id = $1
       AND (
         ($2::uuid IS NOT NULL AND type = 'pack_purchase' AND reference_id = $2::uuid)
         OR (type IN ('trade_buy', 'trade_sell', 'trade_fee')
             AND reference_id IN (SELECT id FROM listing_refs))
         OR (type IN ('auction_win', 'auction_sell', 'auction_fee')
             AND reference_id IN (SELECT id FROM auction_refs))
       )
     ORDER BY created_at DESC
     LIMIT 20`,
    [input.userId, cardRow.pack_id, input.cardId]
  );

  return {
    ...baseCard,
    pnlPercent: acquisitionPrice > 0 ? currentPrice / acquisitionPrice - 1 : 0,
    previousPrice,
    acquiredAtIso: cardRow.created_at,
    activeAuctionId: cardRow.active_auction_id,
    lineage: {
      packId: cardRow.pack_id,
      packTier: cardRow.pack_tier,
      dropId: cardRow.drop_id,
      dropName: cardRow.drop_name
    },
    transactions: transactionsResult.rows.map(mapCollectionTransactionRow)
  };
}

export async function getCollectionPortfolio(userId: string): Promise<CollectionPortfolioView> {
  const result = await query<PortfolioCardRow>(
    `SELECT c.acquisition_price,
            pc.id AS pokemon_card_id,
            pc.rarity_tier
     FROM cards c
     JOIN pokemon_cards pc ON pc.id = c.pokemon_card_id
     WHERE c.owner_id = $1
       AND c.state <> 'in_pack'`,
    [userId]
  );

  const resolvedPrices = await resolveReadThroughPrices(result.rows.map((row) => row.pokemon_card_id));
  const byRarity = new Map<RarityTier, { count: number; marketValue: number }>();
  let totalAcquisitionValue = 0;
  let totalMarketValue = 0;

  for (const row of result.rows) {
    const acquisitionPrice = toMoneyCents(row.acquisition_price);
    const resolved = resolvedPrices.get(row.pokemon_card_id);
    const currentPrice = resolved ? resolved.currentPrice : 0;

    totalAcquisitionValue += acquisitionPrice;
    totalMarketValue += currentPrice;

    const rarity = row.rarity_tier;
    const entry = byRarity.get(rarity) ?? { count: 0, marketValue: 0 };
    entry.count += 1;
    entry.marketValue += currentPrice;
    byRarity.set(rarity, entry);
  }

  return {
    totalCards: result.rows.length,
    totalAcquisitionValue,
    totalMarketValue,
    totalPnl: totalMarketValue - totalAcquisitionValue,
    byRarity: RARITY_ORDER.filter((rarity) => byRarity.has(rarity)).map((rarityTier) => {
      const entry = byRarity.get(rarityTier);
      return {
        rarityTier,
        count: entry?.count ?? 0,
        marketValue: entry?.marketValue ?? 0
      };
    })
  };
}
