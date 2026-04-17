import { withTransaction } from "../db/pool";
import type { CardState, RarityTier } from "../../lib/types";

export type CollectionSort =
  | "newest"
  | "value_desc"
  | "value_asc"
  | "pnl_desc"
  | "pnl_asc";

export type CollectionCardView = {
  id: string;
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

const COLLECTION_SORT_SQL: Record<CollectionSort, string> = {
  newest: "c.created_at DESC",
  value_desc: "pc.current_price DESC, c.created_at DESC",
  value_asc: "pc.current_price ASC, c.created_at DESC",
  pnl_desc: "(pc.current_price - c.acquisition_price) DESC, c.created_at DESC",
  pnl_asc: "(pc.current_price - c.acquisition_price) ASC, c.created_at DESC"
};

type CollectionRow = {
  card_id: string;
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
  current_price: string;
};

type PortfolioSummaryRow = {
  total_cards: string;
  total_acquisition: string;
  total_market: string;
};

type PortfolioRarityRow = {
  rarity_tier: RarityTier;
  count: string;
  market_value: string;
};

function mapCollectionRow(row: CollectionRow): CollectionCardView {
  const acquisitionPrice = Number(row.acquisition_price);
  const currentPrice = Number(row.current_price);

  return {
    id: row.card_id,
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
            price: Number(row.listing_price)
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

  return withTransaction(async (client) => {
    const totalResult = await client.query<{ total: string }>(
      `SELECT COUNT(*)::BIGINT AS total
       FROM cards c
       JOIN pokemon_cards pc ON pc.id = c.pokemon_card_id
       WHERE c.owner_id = $1
         AND c.state <> 'in_pack'
         AND ($2::text IS NULL OR c.state = $2::text)
         AND ($3::text IS NULL OR pc.rarity_tier = $3::text)`,
      [input.userId, stateFilter, rarityFilter]
    );

    const result = await client.query<CollectionRow>(
      `SELECT c.id AS card_id,
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
              pc.current_price
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

    return {
      cards: result.rows.map(mapCollectionRow),
      page,
      limit,
      total: Number(totalResult.rows[0]?.total ?? 0)
    };
  });
}

export async function getCollectionPortfolio(userId: string): Promise<CollectionPortfolioView> {
  return withTransaction(async (client) => {
    const summaryResult = await client.query<PortfolioSummaryRow>(
      `SELECT COUNT(*)::BIGINT AS total_cards,
              COALESCE(SUM(c.acquisition_price), 0)::BIGINT AS total_acquisition,
              COALESCE(SUM(pc.current_price), 0)::BIGINT AS total_market
       FROM cards c
       JOIN pokemon_cards pc ON pc.id = c.pokemon_card_id
       WHERE c.owner_id = $1
         AND c.state <> 'in_pack'`,
      [userId]
    );

    const byRarityResult = await client.query<PortfolioRarityRow>(
      `SELECT pc.rarity_tier,
              COUNT(*)::BIGINT AS count,
              COALESCE(SUM(pc.current_price), 0)::BIGINT AS market_value
       FROM cards c
       JOIN pokemon_cards pc ON pc.id = c.pokemon_card_id
       WHERE c.owner_id = $1
         AND c.state <> 'in_pack'
       GROUP BY pc.rarity_tier
       ORDER BY pc.rarity_tier`,
      [userId]
    );

    const summary = summaryResult.rows[0] ?? {
      total_cards: "0",
      total_acquisition: "0",
      total_market: "0"
    };

    const totalCards = Number(summary.total_cards);
    const totalAcquisitionValue = Number(summary.total_acquisition);
    const totalMarketValue = Number(summary.total_market);

    return {
      totalCards,
      totalAcquisitionValue,
      totalMarketValue,
      totalPnl: totalMarketValue - totalAcquisitionValue,
      byRarity: byRarityResult.rows.map((row) => ({
        rarityTier: row.rarity_tier,
        count: Number(row.count),
        marketValue: Number(row.market_value)
      }))
    };
  });
}
