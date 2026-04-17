import type { QueryResult, QueryResultRow } from "pg";
import type { DropStatus, PackTier } from "../../lib/types";
import { PER_USER_TIER_LIMIT_PER_DROP } from "../config/constants";
import { query, withTransaction } from "../db/pool";
import { getIO } from "../websocket/io";
import { roomNames } from "../websocket/rooms";
import { generatePackCards, insertPackCards } from "./card.service";
import { getDropInventoryCache, setDropInventoryCache } from "../redis/client";

export type DropTierView = {
  dropPackId: string;
  tier: PackTier;
  price: number;
  totalInventory: number;
  remainingInventory: number;
};

export type DropView = {
  id: string;
  scheduledAt: string;
  status: DropStatus;
  createdAt: string;
  tiers: DropTierView[];
};

export type PurchasePackResult = {
  packId: string;
  dropId: string;
  dropPackId: string;
  tier: PackTier;
  pricePaid: number;
  remainingInventory: number;
  purchasedAt: string;
  cardsCount: number;
  newBalance: number;
};

export class DropServiceError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode = 400,
    code = "DROP_SERVICE_ERROR",
    details?: Record<string, unknown>
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

type DropJoinedRow = {
  drop_id: string;
  scheduled_at: string;
  status: DropStatus;
  created_at: string;
  drop_pack_id: string | null;
  tier: PackTier | null;
  price: string | null;
  total_inventory: number | null;
  remaining_inventory: number | null;
};

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
};

function mapDropRows(rows: DropJoinedRow[]): DropView[] {
  const byDrop = new Map<string, DropView>();

  for (const row of rows) {
    if (!byDrop.has(row.drop_id)) {
      byDrop.set(row.drop_id, {
        id: row.drop_id,
        scheduledAt: row.scheduled_at,
        status: row.status,
        createdAt: row.created_at,
        tiers: []
      });
    }

    if (row.drop_pack_id && row.tier && row.price !== null && row.total_inventory !== null && row.remaining_inventory !== null) {
      byDrop.get(row.drop_id)?.tiers.push({
        dropPackId: row.drop_pack_id,
        tier: row.tier,
        price: Number(row.price),
        totalInventory: Number(row.total_inventory),
        remainingInventory: Number(row.remaining_inventory)
      });
    }
  }

  return [...byDrop.values()];
}

async function maybeEmitDropEvent(dropId: string, event: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const io = getIO();
    io.to(roomNames.drop(dropId)).emit(event, payload);
  } catch (_error) {
    // Socket server may not be initialized in script/test contexts.
  }
}

async function readCachedInventory(dropId: string, tier: PackTier): Promise<number | null> {
  try {
    return await getDropInventoryCache(dropId, tier);
  } catch (_error) {
    return null;
  }
}

async function writeCachedInventory(dropId: string, tier: PackTier, remainingInventory: number): Promise<void> {
  try {
    await setDropInventoryCache(dropId, tier, remainingInventory);
  } catch (_error) {
    // Redis is a non-authoritative cache layer in this flow.
  }
}

export async function listDrops(limit = 20): Promise<DropView[]> {
  const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);

  const result = await withTransaction(async (client) => {
    return client.query<DropJoinedRow>(
      `SELECT d.id AS drop_id,
              d.scheduled_at,
              d.status,
              d.created_at,
              dp.id AS drop_pack_id,
              dp.tier,
              dp.price,
              dp.total_inventory,
              dp.remaining_inventory
       FROM drops d
       LEFT JOIN drop_packs dp ON dp.drop_id = d.id
       ORDER BY CASE d.status
                  WHEN 'active' THEN 0
                  WHEN 'upcoming' THEN 1
                  ELSE 2
                END,
                d.scheduled_at DESC,
                dp.tier ASC
       LIMIT $1`,
      [normalizedLimit * 3]
    );
  });

  const mapped = mapDropRows(result.rows);
  return mapped.slice(0, normalizedLimit);
}

export async function getDrop(dropId: string): Promise<DropView> {
  const result = await withTransaction(async (client) => {
    return client.query<DropJoinedRow>(
      `SELECT d.id AS drop_id,
              d.scheduled_at,
              d.status,
              d.created_at,
              dp.id AS drop_pack_id,
              dp.tier,
              dp.price,
              dp.total_inventory,
              dp.remaining_inventory
       FROM drops d
       LEFT JOIN drop_packs dp ON dp.drop_id = d.id
       WHERE d.id = $1
       ORDER BY dp.tier ASC`,
      [dropId]
    );
  });

  if (result.rowCount === 0) {
    throw new DropServiceError("Drop not found.", 404, "DROP_NOT_FOUND", { dropId });
  }

  return mapDropRows(result.rows)[0];
}

export async function purchasePack(input: {
  userId: string;
  dropId: string;
  tier: PackTier;
}): Promise<PurchasePackResult> {
  const cachedRemaining = await readCachedInventory(input.dropId, input.tier);

  if (cachedRemaining !== null && cachedRemaining <= 0) {
    throw new DropServiceError("Pack is sold out.", 409, "SOLD_OUT", {
      dropId: input.dropId,
      tier: input.tier
    });
  }

  const purchase = await withTransaction(async (client) => {
    const userBalanceResult = await client.query<{ balance: string }>(
      "SELECT balance FROM users WHERE id = $1 FOR UPDATE",
      [input.userId]
    );

    if (userBalanceResult.rowCount !== 1) {
      throw new DropServiceError("User not found.", 404, "USER_NOT_FOUND");
    }

    const activeHoldsResult = await client.query<{ held: string }>(
      "SELECT COALESCE(SUM(amount), 0)::BIGINT AS held FROM balance_holds WHERE user_id = $1 AND status = 'active'",
      [input.userId]
    );

    const dropPackResult = await client.query<{
      drop_pack_id: string;
      price: string;
      total_inventory: number;
      remaining_inventory: number;
      drop_status: DropStatus;
    }>(
      `SELECT dp.id AS drop_pack_id,
              dp.price,
              dp.total_inventory,
              dp.remaining_inventory,
              d.status AS drop_status
       FROM drop_packs dp
       JOIN drops d ON d.id = dp.drop_id
       WHERE dp.drop_id = $1
         AND dp.tier = $2
       FOR UPDATE OF dp`,
      [input.dropId, input.tier]
    );

    if (dropPackResult.rowCount !== 1) {
      throw new DropServiceError("Drop tier not found.", 404, "DROP_TIER_NOT_FOUND", {
        dropId: input.dropId,
        tier: input.tier
      });
    }

    const dropPack = dropPackResult.rows[0];

    if (dropPack.drop_status !== "active") {
      throw new DropServiceError("Drop is not active.", 409, "DROP_NOT_ACTIVE", {
        dropId: input.dropId,
        status: dropPack.drop_status
      });
    }

    const purchasesForTier = await client.query<{ purchased_count: string }>(
      `SELECT COUNT(*)::BIGINT AS purchased_count
       FROM packs
       WHERE user_id = $1
         AND drop_pack_id IN (
           SELECT id
           FROM drop_packs
           WHERE drop_id = $2
             AND tier = $3
         )`,
      [input.userId, input.dropId, input.tier]
    );

    const purchasedCount = Number(purchasesForTier.rows[0].purchased_count);

    if (purchasedCount >= PER_USER_TIER_LIMIT_PER_DROP) {
      throw new DropServiceError(
        "Per-user tier limit reached for this drop.",
        409,
        "PER_USER_TIER_LIMIT_REACHED",
        {
          dropId: input.dropId,
          tier: input.tier,
          limit: PER_USER_TIER_LIMIT_PER_DROP
        }
      );
    }

    const price = Number(dropPack.price);
    const balance = Number(userBalanceResult.rows[0].balance);
    const held = Number(activeHoldsResult.rows[0].held);
    const availableBalance = balance - held;

    if (availableBalance < price) {
      throw new DropServiceError("Insufficient available balance.", 409, "INSUFFICIENT_BALANCE", {
        availableBalance,
        price
      });
    }

    const decrementResult = await client.query<{ remaining_inventory: number }>(
      `UPDATE drop_packs
       SET remaining_inventory = remaining_inventory - 1
       WHERE id = $1
         AND remaining_inventory > 0
       RETURNING remaining_inventory`,
      [dropPack.drop_pack_id]
    );

    if (decrementResult.rowCount !== 1) {
      throw new DropServiceError("Pack is sold out.", 409, "SOLD_OUT", {
        dropId: input.dropId,
        tier: input.tier
      });
    }

    const remainingInventory = Number(decrementResult.rows[0].remaining_inventory);
    const newBalance = balance - price;

    await client.query("UPDATE users SET balance = $1 WHERE id = $2", [newBalance, input.userId]);

    const packResult = await client.query<{ id: string; purchased_at: string }>(
      `INSERT INTO packs (user_id, drop_pack_id, tier, price_paid)
       VALUES ($1, $2, $3, $4)
       RETURNING id, purchased_at`,
      [input.userId, dropPack.drop_pack_id, input.tier, price]
    );

    const packId = packResult.rows[0].id;
    const purchasedAt = packResult.rows[0].purchased_at;

    const generatedCards = await generatePackCards(input.tier, client);
    const insertedCards = await insertPackCards(
      {
        packId,
        ownerId: input.userId,
        cards: generatedCards
      },
      client
    );

    const totalCardValue = insertedCards.reduce((sum, card) => sum + card.acquisitionPrice, 0);
    const packMargin = price - totalCardValue;

    await client.query(
      `INSERT INTO transactions (user_id, type, amount, reference_id, balance_after)
       VALUES ($1, 'pack_purchase', $2, $3, $4)`,
      [input.userId, -price, packId, newBalance]
    );

    await client.query(
      `INSERT INTO platform_revenue (type, amount, reference_id)
       VALUES ('pack_margin', $1, $2)`,
      [packMargin, packId]
    );

    return {
      packId,
      dropId: input.dropId,
      dropPackId: dropPack.drop_pack_id,
      tier: input.tier,
      pricePaid: price,
      remainingInventory,
      purchasedAt,
      cardsCount: insertedCards.length,
      newBalance
    } satisfies PurchasePackResult;
  });

  await writeCachedInventory(purchase.dropId, purchase.tier, purchase.remainingInventory);

  await maybeEmitDropEvent(purchase.dropId, "inventory_update", {
    dropId: purchase.dropId,
    tier: purchase.tier,
    remainingInventory: purchase.remainingInventory
  });

  if (purchase.remainingInventory === 0) {
    await maybeEmitDropEvent(purchase.dropId, "sold_out", {
      dropId: purchase.dropId,
      tier: purchase.tier
    });
  }

  return purchase;
}

export async function syncDropInventoryCache(dropId: string, client?: Queryable): Promise<void> {
  const tiers = client
    ? await client.query<{ tier: PackTier; remaining_inventory: number }>(
        "SELECT tier, remaining_inventory FROM drop_packs WHERE drop_id = $1",
        [dropId]
      )
    : await query<{ tier: PackTier; remaining_inventory: number }>(
        "SELECT tier, remaining_inventory FROM drop_packs WHERE drop_id = $1",
        [dropId]
      );

  await Promise.all(
    tiers.rows.map((row) => writeCachedInventory(dropId, row.tier, Number(row.remaining_inventory)))
  );
}
