import { withTransaction } from "../db/pool";
import type { CardState, PackTier, RarityTier } from "../../lib/types";

export type UserPackSummary = {
  id: string;
  dropId: string;
  dropName: string;
  dropScheduledAt: string;
  dropPackId: string;
  tier: PackTier;
  pricePaid: number;
  opened: boolean;
  purchasedAt: string;
  openedAt: string | null;
};

export type UserPacksCursor = {
  purchasedAt: string;
  id: string;
};

export type ListUserPacksInput = {
  userId: string;
  limit?: number;
  cursor?: string | null;
  opened?: boolean;
};

export type ListUserPacksResult = {
  packs: UserPackSummary[];
  nextCursor: string | null;
};

export type OpenedPackSlot = {
  slotNumber: number;
  revealed: boolean;
};

export type OpenPackResult = {
  packId: string;
  opened: boolean;
  openedAt: string;
  cards: OpenedPackSlot[];
};

export type PackDetailCard = {
  id: string;
  slotNumber: number;
  rarityTier: RarityTier;
  state: CardState;
  acquisitionPrice: number;
  pokemonCard: {
    id: string;
    tcgId: string;
    name: string;
    setName: string;
    rarity: string;
    rarityTier: RarityTier;
    imageUrl: string | null;
    imageUrlHires: string | null;
    currentPrice: number;
  };
};

export type UserPackDetail = UserPackSummary & {
  cards: PackDetailCard[] | null;
};

export type RevealedPackCard = {
  id: string;
  slotNumber: number;
  rarityTier: RarityTier;
  state: CardState;
  acquisitionPrice: number;
  pokemonCard: {
    id: string;
    tcgId: string;
    name: string;
    setName: string;
    rarity: string;
    rarityTier: RarityTier;
    imageUrl: string | null;
    imageUrlHires: string | null;
    currentPrice: number;
  };
};

export class PackServiceError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode = 400,
    code = "PACK_SERVICE_ERROR",
    details?: Record<string, unknown>
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

const USER_PACKS_DEFAULT_LIMIT = 50;
const USER_PACKS_MAX_LIMIT = 200;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_DROP_NAME = "Untitled Drop";

function normalizeUserPacksLimit(limit?: number): number {
  if (!Number.isFinite(limit)) {
    return USER_PACKS_DEFAULT_LIMIT;
  }

  return Math.min(USER_PACKS_MAX_LIMIT, Math.max(1, Math.trunc(limit as number)));
}

function mapUserPackSummary(row: {
  id: string;
  drop_id: string;
  drop_name: string | null;
  drop_scheduled_at: string;
  drop_pack_id: string;
  tier: PackTier;
  price_paid: string;
  opened: boolean;
  purchased_at: string;
  opened_at: string | null;
}): UserPackSummary {
  return {
    id: row.id,
    dropId: row.drop_id,
    dropName: row.drop_name ?? DEFAULT_DROP_NAME,
    dropScheduledAt: row.drop_scheduled_at,
    dropPackId: row.drop_pack_id,
    tier: row.tier,
    pricePaid: Number(row.price_paid),
    opened: row.opened,
    purchasedAt: row.purchased_at,
    openedAt: row.opened_at
  };
}

export function encodeUserPacksCursor(cursor: UserPacksCursor): string {
  return Buffer.from(
    JSON.stringify({
      purchasedAt: cursor.purchasedAt,
      id: cursor.id
    }),
    "utf8"
  ).toString("base64url");
}

export function decodeUserPacksCursor(cursor: string | null | undefined): UserPacksCursor | null {
  if (!cursor || cursor.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      purchasedAt?: unknown;
      id?: unknown;
    };

    if (typeof parsed.purchasedAt !== "string" || Number.isNaN(Date.parse(parsed.purchasedAt))) {
      return null;
    }

    if (typeof parsed.id !== "string" || !UUID_REGEX.test(parsed.id)) {
      return null;
    }

    return {
      purchasedAt: parsed.purchasedAt,
      id: parsed.id
    };
  } catch (_error) {
    return null;
  }
}

export async function listUserPacks(input: ListUserPacksInput): Promise<ListUserPacksResult> {
  const normalizedLimit = normalizeUserPacksLimit(input.limit);
  const cursor = decodeUserPacksCursor(input.cursor);

  const result = await withTransaction(async (client) => {
    const params: unknown[] = [input.userId];
    const filters: string[] = ["p.user_id = $1"];

    if (typeof input.opened === "boolean") {
      params.push(input.opened);
      filters.push(`p.opened = $${params.length}`);
    }

    if (cursor) {
      params.push(cursor.purchasedAt);
      params.push(cursor.id);
      filters.push(`(p.purchased_at, p.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }

    params.push(normalizedLimit + 1);

    return client.query<{
      id: string;
      drop_id: string;
      drop_name: string | null;
      drop_scheduled_at: string;
      drop_pack_id: string;
      tier: PackTier;
      price_paid: string;
      opened: boolean;
      purchased_at: string;
      opened_at: string | null;
    }>(
      `SELECT p.id,
              dp.drop_id,
              d.name AS drop_name,
              d.scheduled_at AS drop_scheduled_at,
              p.drop_pack_id,
              p.tier,
              p.price_paid,
              p.opened,
              p.purchased_at,
              p.opened_at
       FROM packs p
       JOIN drop_packs dp ON dp.id = p.drop_pack_id
       JOIN drops d ON d.id = dp.drop_id
       WHERE ${filters.join(" AND ")}
       ORDER BY p.purchased_at DESC, p.id DESC
       LIMIT $${params.length}`,
      params
    );
  });

  const hasMore = result.rows.length > normalizedLimit;
  const pageRows = hasMore ? result.rows.slice(0, normalizedLimit) : result.rows;
  const nextCursor = hasMore
    ? encodeUserPacksCursor({
        purchasedAt: pageRows[pageRows.length - 1].purchased_at,
        id: pageRows[pageRows.length - 1].id
      })
    : null;

  return {
    packs: pageRows.map(mapUserPackSummary),
    nextCursor
  };
}

export async function getUserPackDetail(userId: string, packId: string): Promise<UserPackDetail> {
  return withTransaction(async (client) => {
    const packResult = await client.query<{
      id: string;
      drop_id: string;
      drop_name: string | null;
      drop_scheduled_at: string;
      drop_pack_id: string;
      tier: PackTier;
      price_paid: string;
      opened: boolean;
      purchased_at: string;
      opened_at: string | null;
    }>(
      `SELECT p.id,
              dp.drop_id,
              d.name AS drop_name,
              d.scheduled_at AS drop_scheduled_at,
              p.drop_pack_id,
              p.tier,
              p.price_paid,
              p.opened,
              p.purchased_at,
              p.opened_at
       FROM packs p
       JOIN drop_packs dp ON dp.id = p.drop_pack_id
       JOIN drops d ON d.id = dp.drop_id
       WHERE p.id = $1
         AND p.user_id = $2`,
      [packId, userId]
    );

    if (packResult.rowCount !== 1) {
      throw new PackServiceError("Pack not found.", 404, "PACK_NOT_FOUND", { packId });
    }

    const pack = packResult.rows[0];

    if (!pack.opened) {
      return {
        id: pack.id,
        dropId: pack.drop_id,
        dropName: pack.drop_name ?? DEFAULT_DROP_NAME,
        dropScheduledAt: pack.drop_scheduled_at,
        dropPackId: pack.drop_pack_id,
        tier: pack.tier,
        pricePaid: Number(pack.price_paid),
        opened: pack.opened,
        purchasedAt: pack.purchased_at,
        openedAt: pack.opened_at,
        cards: null
      };
    }

    const cardsResult = await client.query<{
      id: string;
      slot_number: number;
      rarity_tier: RarityTier;
      state: CardState;
      acquisition_price: string;
      pokemon_card_id: string;
      tcg_id: string;
      name: string;
      set_name: string;
      rarity: string;
      pokemon_rarity_tier: RarityTier;
      image_url: string | null;
      image_url_hires: string | null;
      current_price: string;
    }>(
      `SELECT c.id,
              c.slot_number,
              c.rarity_tier,
              c.state,
              c.acquisition_price,
              c.pokemon_card_id,
              pc.tcg_id,
              pc.name,
              pc.set_name,
              pc.rarity,
              pc.rarity_tier AS pokemon_rarity_tier,
              pc.image_url,
              pc.image_url_hires,
              pc.current_price
       FROM cards c
       JOIN pokemon_cards pc ON pc.id = c.pokemon_card_id
       WHERE c.pack_id = $1
         AND c.owner_id = $2
       ORDER BY c.slot_number ASC`,
      [packId, userId]
    );

    return {
      id: pack.id,
      dropId: pack.drop_id,
      dropName: pack.drop_name ?? DEFAULT_DROP_NAME,
      dropScheduledAt: pack.drop_scheduled_at,
      dropPackId: pack.drop_pack_id,
      tier: pack.tier,
      pricePaid: Number(pack.price_paid),
      opened: pack.opened,
      purchasedAt: pack.purchased_at,
      openedAt: pack.opened_at,
      cards: cardsResult.rows.map((card) => ({
        id: card.id,
        slotNumber: card.slot_number,
        rarityTier: card.rarity_tier,
        state: card.state,
        acquisitionPrice: Number(card.acquisition_price),
        pokemonCard: {
          id: card.pokemon_card_id,
          tcgId: card.tcg_id,
          name: card.name,
          setName: card.set_name,
          rarity: card.rarity,
          rarityTier: card.pokemon_rarity_tier,
          imageUrl: card.image_url,
          imageUrlHires: card.image_url_hires,
          currentPrice: Number(card.current_price)
        }
      }))
    };
  });
}

export async function openPack(userId: string, packId: string): Promise<OpenPackResult> {
  return withTransaction(async (client) => {
    const packResult = await client.query<{ id: string; opened: boolean; opened_at: string | null }>(
      `SELECT id, opened, opened_at
       FROM packs
       WHERE id = $1
         AND user_id = $2
       FOR UPDATE`,
      [packId, userId]
    );

    if (packResult.rowCount !== 1) {
      throw new PackServiceError("Pack not found.", 404, "PACK_NOT_FOUND", { packId });
    }

    const pack = packResult.rows[0];
    let openedAt = pack.opened_at;

    if (!pack.opened) {
      const updatedPack = await client.query<{ opened_at: string }>(
        `UPDATE packs
         SET opened = true,
             opened_at = now()
         WHERE id = $1
         RETURNING opened_at`,
        [packId]
      );

      openedAt = updatedPack.rows[0].opened_at;

      await client.query(
        `UPDATE cards
         SET state = 'owned'
         WHERE pack_id = $1
           AND owner_id = $2
           AND state = 'in_pack'`,
        [packId, userId]
      );
    }

    const slotsResult = await client.query<{ slot_number: number }>(
      `SELECT slot_number
       FROM cards
       WHERE pack_id = $1
       ORDER BY slot_number ASC`,
      [packId]
    );

    if (slotsResult.rowCount === 0) {
      throw new PackServiceError("Pack has no cards.", 500, "PACK_CARDS_MISSING", { packId });
    }

    return {
      packId,
      opened: true,
      openedAt: openedAt ?? new Date().toISOString(),
      cards: slotsResult.rows.map((row) => ({
        slotNumber: row.slot_number,
        revealed: false
      }))
    };
  });
}

export async function revealCard(input: {
  userId: string;
  packId: string;
  slotNumber: number;
}): Promise<RevealedPackCard> {
  return withTransaction(async (client) => {
    const packResult = await client.query<{ opened: boolean }>(
      `SELECT opened
       FROM packs
       WHERE id = $1
         AND user_id = $2`,
      [input.packId, input.userId]
    );

    if (packResult.rowCount !== 1) {
      throw new PackServiceError("Pack not found.", 404, "PACK_NOT_FOUND", { packId: input.packId });
    }

    if (!packResult.rows[0].opened) {
      throw new PackServiceError("Pack must be opened before reveal.", 409, "PACK_NOT_OPENED", {
        packId: input.packId
      });
    }

    const cardResult = await client.query<{
      id: string;
      slot_number: number;
      rarity_tier: RarityTier;
      state: CardState;
      acquisition_price: string;
      pokemon_card_id: string;
      tcg_id: string;
      name: string;
      set_name: string;
      rarity: string;
      pokemon_rarity_tier: RarityTier;
      image_url: string | null;
      image_url_hires: string | null;
      current_price: string;
    }>(
      `SELECT c.id,
              c.slot_number,
              c.rarity_tier,
              c.state,
              c.acquisition_price,
              c.pokemon_card_id,
              pc.tcg_id,
              pc.name,
              pc.set_name,
              pc.rarity,
              pc.rarity_tier AS pokemon_rarity_tier,
              pc.image_url,
              pc.image_url_hires,
              pc.current_price
       FROM cards c
       JOIN pokemon_cards pc ON pc.id = c.pokemon_card_id
       WHERE c.pack_id = $1
         AND c.owner_id = $2
         AND c.slot_number = $3`,
      [input.packId, input.userId, input.slotNumber]
    );

    if (cardResult.rowCount !== 1) {
      throw new PackServiceError("Card slot not found.", 404, "PACK_SLOT_NOT_FOUND", {
        packId: input.packId,
        slotNumber: input.slotNumber
      });
    }

    const card = cardResult.rows[0];

    if (card.state === "in_pack") {
      throw new PackServiceError("Pack card is not available for reveal yet.", 409, "CARD_NOT_REVEALABLE", {
        packId: input.packId,
        slotNumber: input.slotNumber
      });
    }

    return {
      id: card.id,
      slotNumber: card.slot_number,
      rarityTier: card.rarity_tier,
      state: card.state,
      acquisitionPrice: Number(card.acquisition_price),
      pokemonCard: {
        id: card.pokemon_card_id,
        tcgId: card.tcg_id,
        name: card.name,
        setName: card.set_name,
        rarity: card.rarity,
        rarityTier: card.pokemon_rarity_tier,
        imageUrl: card.image_url,
        imageUrlHires: card.image_url_hires,
        currentPrice: Number(card.current_price)
      }
    };
  });
}
