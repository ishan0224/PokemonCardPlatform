import type { QueryResult, QueryResultRow } from "pg";
import { query } from "../db/pool";

const MAX_PAGE_SIZE = 50;

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
};

export type AdminCardSetItem = {
  setKey: string;
  setName: string;
  setId: string | null;
  totalCount: number;
  rarityCounts: {
    common: number;
    uncommon: number;
    rare: number;
    holoRare: number;
    ultraRare: number;
    chase: number;
  };
};

export type AdminCardSearchItem = {
  id: string;
  tcgId: string;
  name: string;
  setName: string;
  setId: string | null;
  setKey: string;
  rarityTier: string;
  currentPrice: number;
  imageUrl: string | null;
  imageUrlHires: string | null;
};

type SetCursor = {
  setName: string;
  setKey: string;
};

type CardCursor = {
  name: string;
  id: string;
};

type SetRow = {
  set_key: string;
  set_name: string;
  set_id: string | null;
  total_count: string;
  common_count: string;
  uncommon_count: string;
  rare_count: string;
  holo_rare_count: string;
  ultra_rare_count: string;
  chase_count: string;
};

type CardRow = {
  id: string;
  tcg_id: string;
  name: string;
  set_name: string;
  set_id: string | null;
  set_key: string;
  rarity_tier: string;
  current_price: string;
  image_url: string | null;
  image_url_hires: string | null;
};

export class AdminCardCatalogError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, statusCode = 400, code = "ADMIN_CARD_CATALOG_ERROR", details?: Record<string, unknown>) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function encodeCursor(cursor: SetCursor | CardCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeSetCursor(value: string | null | undefined): SetCursor | null {
  if (!value || value.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      setName?: unknown;
      setKey?: unknown;
    };

    if (typeof parsed.setName !== "string" || typeof parsed.setKey !== "string") {
      throw new Error("invalid cursor shape");
    }

    return {
      setName: parsed.setName,
      setKey: parsed.setKey
    };
  } catch (_error) {
    throw new AdminCardCatalogError("Invalid cursor.", 400, "INVALID_CURSOR");
  }
}

function decodeCardCursor(value: string | null | undefined): CardCursor | null {
  if (!value || value.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      name?: unknown;
      id?: unknown;
    };

    if (typeof parsed.name !== "string" || typeof parsed.id !== "string") {
      throw new Error("invalid cursor shape");
    }

    return {
      name: parsed.name,
      id: parsed.id
    };
  } catch (_error) {
    throw new AdminCardCatalogError("Invalid cursor.", 400, "INVALID_CURSOR");
  }
}

function clampLimit(limit: number | undefined, defaultLimit: number): number {
  return Math.min(Math.max(Math.trunc(limit ?? defaultLimit), 1), MAX_PAGE_SIZE);
}

async function listAdminCardSetsWithin(
  client: Queryable,
  input: { cursor?: string | null; limit?: number }
): Promise<{ items: AdminCardSetItem[]; nextCursor: string | null }> {
  const limit = clampLimit(input.limit, 20);
  const cursor = decodeSetCursor(input.cursor);

  const params: unknown[] = [];
  const whereClauses: string[] = [];

  if (cursor) {
    params.push(cursor.setName, cursor.setKey);
    whereClauses.push(`(set_name, set_key) > ($${params.length - 1}, $${params.length})`);
  }

  params.push(limit + 1);

  const result = await client.query<SetRow>(
    `SELECT set_key,
            set_name,
            set_id,
            total_count,
            common_count,
            uncommon_count,
            rare_count,
            holo_rare_count,
            ultra_rare_count,
            chase_count
     FROM (
       SELECT COALESCE(set_id, '__name__:' || set_name) AS set_key,
              set_name,
              set_id,
              COUNT(*)::BIGINT AS total_count,
              COUNT(*) FILTER (WHERE rarity_tier = 'common')::BIGINT AS common_count,
              COUNT(*) FILTER (WHERE rarity_tier = 'uncommon')::BIGINT AS uncommon_count,
              COUNT(*) FILTER (WHERE rarity_tier = 'rare')::BIGINT AS rare_count,
              COUNT(*) FILTER (WHERE rarity_tier = 'holo_rare')::BIGINT AS holo_rare_count,
              COUNT(*) FILTER (WHERE rarity_tier = 'ultra_rare')::BIGINT AS ultra_rare_count,
              COUNT(*) FILTER (WHERE rarity_tier = 'chase')::BIGINT AS chase_count
       FROM pokemon_cards
       GROUP BY set_key, set_name, set_id
     ) sets
     ${whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : ""}
     ORDER BY set_name ASC, set_key ASC
     LIMIT $${params.length}`,
    params
  );

  const hasNext = result.rows.length > limit;
  const pageRows = hasNext ? result.rows.slice(0, limit) : result.rows;

  const items = pageRows.map<AdminCardSetItem>((row) => ({
    setKey: row.set_key,
    setName: row.set_name,
    setId: row.set_id,
    totalCount: Number(row.total_count),
    rarityCounts: {
      common: Number(row.common_count),
      uncommon: Number(row.uncommon_count),
      rare: Number(row.rare_count),
      holoRare: Number(row.holo_rare_count),
      ultraRare: Number(row.ultra_rare_count),
      chase: Number(row.chase_count)
    }
  }));

  return {
    items,
    nextCursor: hasNext
      ? encodeCursor({
          setName: pageRows[pageRows.length - 1].set_name,
          setKey: pageRows[pageRows.length - 1].set_key
        })
      : null
  };
}

async function searchAdminCardsWithin(
  client: Queryable,
  input: { query: string; cursor?: string | null; limit?: number }
): Promise<{ items: AdminCardSearchItem[]; nextCursor: string | null }> {
  const normalizedQuery = input.query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return { items: [], nextCursor: null };
  }

  const limit = clampLimit(input.limit, 20);
  const cursor = decodeCardCursor(input.cursor);

  const params: unknown[] = [`%${normalizedQuery}%`];
  const whereClauses: string[] = [
    `(LOWER(name) LIKE $1 OR LOWER(tcg_id) LIKE $1 OR LOWER(set_name) LIKE $1)`
  ];

  if (cursor) {
    params.push(cursor.name, cursor.id);
    whereClauses.push(`(name, id) > ($${params.length - 1}, $${params.length}::uuid)`);
  }

  params.push(limit + 1);

  const result = await client.query<CardRow>(
    `SELECT id,
            tcg_id,
            name,
            set_name,
            set_id,
            COALESCE(set_id, '__name__:' || set_name) AS set_key,
            rarity_tier,
            current_price,
            image_url,
            image_url_hires
     FROM pokemon_cards
     WHERE ${whereClauses.join(" AND ")}
     ORDER BY name ASC, id ASC
     LIMIT $${params.length}`,
    params
  );

  const hasNext = result.rows.length > limit;
  const pageRows = hasNext ? result.rows.slice(0, limit) : result.rows;

  const items = pageRows.map<AdminCardSearchItem>((row) => ({
    id: row.id,
    tcgId: row.tcg_id,
    name: row.name,
    setName: row.set_name,
    setId: row.set_id,
    setKey: row.set_key,
    rarityTier: row.rarity_tier,
    currentPrice: Number(row.current_price),
    imageUrl: row.image_url,
    imageUrlHires: row.image_url_hires
  }));

  return {
    items,
    nextCursor: hasNext
      ? encodeCursor({
          name: pageRows[pageRows.length - 1].name,
          id: pageRows[pageRows.length - 1].id
        })
      : null
  };
}

export async function listAdminCardSets(input: {
  cursor?: string | null;
  limit?: number;
} = {}): Promise<{ items: AdminCardSetItem[]; nextCursor: string | null }> {
  const dbClient: Queryable = { query };
  return listAdminCardSetsWithin(dbClient, input);
}

export async function searchAdminCards(input: {
  query: string;
  cursor?: string | null;
  limit?: number;
}): Promise<{ items: AdminCardSearchItem[]; nextCursor: string | null }> {
  if (!input || typeof input.query !== "string") {
    throw new AdminCardCatalogError("query is required.", 400, "INVALID_CARD_QUERY", {
      field: "query"
    });
  }

  const dbClient: Queryable = { query };
  return searchAdminCardsWithin(dbClient, input);
}
