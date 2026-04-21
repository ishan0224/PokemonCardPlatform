import { randomBytes } from "crypto";
import type { QueryResult, QueryResultRow } from "pg";
import type { DropStatus, PackTier } from "../../lib/types";
import { PER_USER_TIER_LIMIT_PER_DROP } from "../config/constants";
import { query, withTransaction } from "../db/pool";
import { emitPurchaseObservability } from "../observability/purchase-observability";
import { getIO } from "../websocket/io";
import { roomNames } from "../websocket/rooms";
import { emitAdminMetricsDeltaFireAndForget } from "../websocket/admin-metrics-coalescer";
import {
  generatePackCards,
  hydrateCardsForSlotPlan,
  insertPackCardsBulk,
  materializeGeneratedCards
} from "./card.service";
import { getDropInventoryCache, setDropInventoryCache } from "../redis/client";
import { getGenerationVersionById } from "./pack-generation-version.service";
import { buildInventoryConsumeTelemetry, resolvePurchaseRejectCode } from "./purchase-hardening.service";
import { allocateServerSeedNonce, decryptServerSeed, lockUnrevealedServerSeed } from "./fairness.service";
import { isPackMarginOutsideTargetBand } from "./economics.service";
import { writeSecurityEventFireAndForget } from "./security-event.service";

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

type PurchaseObservability = {
  cacheSoldOutHint: boolean;
  queryCount: number;
  txDurationMs: number;
  inventoryConsumeRoundtripMs: number | null;
  generationContextLoadMs: number;
  deterministicGenerateMs: number;
  hydrateCardsBatchMs: number;
  cardsBulkInsertMs: number;
  expectedSlotCount: number;
  uniqueSelectedCardCount: number;
  insertedCardCount: number;
  outcome: "success" | "error";
  errorCode: string | null;
};

function nowMs(): number {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

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

export async function syncDropInventoryCacheOnPurchase(input: {
  dropId: string;
  tier: PackTier;
  remainingInventory: number;
}): Promise<void> {
  await writeCachedInventory(input.dropId, input.tier, input.remainingInventory);
}

export async function syncDropInventoryCacheOnDropStart(dropId: string): Promise<void> {
  await syncDropInventoryCache(dropId);
}

export async function syncDropInventoryCacheOnDropComplete(dropId: string): Promise<void> {
  await syncDropInventoryCache(dropId);
}

type TrackedQuery = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
) => Promise<QueryResult<T>>;

type PurchaseContextRow = {
  drop_pack_id: string;
  price: string;
  total_inventory: number;
  remaining_inventory: number;
  drop_status: DropStatus;
  active_generation_version_id: string | null;
};

type PurchaseContext = {
  dropPackId: string;
  price: number;
  generationVersionId: string;
  balance: number;
};

type InventoryConsumeResult = {
  remainingInventory: number;
  statementElapsedMs: number;
  newBalance: number;
};

type FairnessCommitmentResult = {
  serverSeedId: string;
  nonce: bigint;
  clientSeed: string;
  serverSeedHex: string;
};

function createTrackedQuery(client: Queryable, observability: PurchaseObservability): TrackedQuery {
  return async <T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = []
  ): Promise<QueryResult<T>> => {
    observability.queryCount += 1;
    return client.query<T>(text, params);
  };
}

async function loadPurchaseContext(
  input: { userId: string; dropId: string; tier: PackTier },
  trackedQuery: TrackedQuery
): Promise<PurchaseContext> {
  const userBalanceResult = await trackedQuery<{ balance: string }>(
    "SELECT balance FROM users WHERE id = $1 FOR UPDATE",
    [input.userId]
  );

  if (userBalanceResult.rowCount !== 1) {
    throw new DropServiceError("User not found.", 404, "USER_NOT_FOUND");
  }

  const activeHoldsResult = await trackedQuery<{ held: string }>(
    "SELECT COALESCE(SUM(amount), 0)::BIGINT AS held FROM balance_holds WHERE user_id = $1 AND status = 'active'",
    [input.userId]
  );

  const dropPackContextResult = await trackedQuery<PurchaseContextRow>(
    `SELECT dp.id AS drop_pack_id,
            dp.price,
            dp.total_inventory,
            dp.remaining_inventory,
            d.status AS drop_status,
            d.active_generation_version_id
     FROM drop_packs dp
     JOIN drops d ON d.id = dp.drop_id
     WHERE dp.drop_id = $1
       AND dp.tier = $2`,
    [input.dropId, input.tier]
  );

  if (dropPackContextResult.rowCount !== 1) {
    throw new DropServiceError("Drop tier not found.", 404, "DROP_TIER_NOT_FOUND", {
      dropId: input.dropId,
      tier: input.tier
    });
  }

  const dropPack = dropPackContextResult.rows[0];
  const generationVersionId = dropPack.active_generation_version_id;

  if (dropPack.drop_status !== "active") {
    throw new DropServiceError("Drop is not active.", 409, "DROP_NOT_ACTIVE", {
      dropId: input.dropId,
      status: dropPack.drop_status
    });
  }

  if (!generationVersionId) {
    throw new DropServiceError(
      "Active generation version is required before purchasing packs.",
      500,
      "GENERATION_VERSION_MISSING",
      { dropId: input.dropId, tier: input.tier }
    );
  }

  const purchasesForTier = await trackedQuery<{ purchased_count: string }>(
    `SELECT COUNT(*)::BIGINT AS purchased_count
     FROM packs
     WHERE user_id = $1
       AND drop_pack_id = $2`,
    [input.userId, dropPack.drop_pack_id]
  );

  const purchasedCount = Number(purchasesForTier.rows[0].purchased_count);
  if (purchasedCount >= PER_USER_TIER_LIMIT_PER_DROP) {
    throw new DropServiceError("Per-user tier limit reached for this drop.", 409, "PER_USER_TIER_LIMIT_REACHED", {
      dropId: input.dropId,
      tier: input.tier,
      limit: PER_USER_TIER_LIMIT_PER_DROP
    });
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

  return {
    dropPackId: dropPack.drop_pack_id,
    price,
    generationVersionId,
    balance
  };
}

async function consumeInventoryAndChargeBalance(input: {
  userId: string;
  dropId: string;
  tier: PackTier;
  dropPackId: string;
  balance: number;
  price: number;
  trackedQuery: TrackedQuery;
}): Promise<InventoryConsumeResult> {
  const decrementResult = await input.trackedQuery<{ remaining_inventory: number; statement_elapsed_ms: string }>(
    `WITH started AS (
       SELECT clock_timestamp() AS started_at
     ),
     decrement AS (
       UPDATE drop_packs dp
       SET remaining_inventory = dp.remaining_inventory - 1
       FROM drops d
       WHERE dp.id = $1
         AND d.id = dp.drop_id
         AND d.status = 'active'
         AND dp.remaining_inventory > 0
       RETURNING dp.remaining_inventory
     )
     SELECT decrement.remaining_inventory,
            (EXTRACT(EPOCH FROM (clock_timestamp() - started.started_at)) * 1000)::numeric(20,3) AS statement_elapsed_ms
     FROM started
     JOIN decrement ON TRUE`,
    [input.dropPackId]
  );

  if (decrementResult.rowCount !== 1) {
    const failureContext = await input.trackedQuery<{
      drop_status: DropStatus;
      remaining_inventory: number;
    }>(
      `SELECT d.status AS drop_status, dp.remaining_inventory
       FROM drop_packs dp
       JOIN drops d ON d.id = dp.drop_id
       WHERE dp.id = $1`,
      [input.dropPackId]
    );

    if (failureContext.rowCount === 1) {
      const failureCode = resolvePurchaseRejectCode({
        dropStatus: failureContext.rows[0].drop_status,
        remainingInventory: Number(failureContext.rows[0].remaining_inventory)
      });

      if (failureCode === "DROP_NOT_ACTIVE") {
        throw new DropServiceError("Drop is not active.", 409, "DROP_NOT_ACTIVE", {
          dropId: input.dropId,
          status: failureContext.rows[0].drop_status
        });
      }
    }

    throw new DropServiceError("Pack is sold out.", 409, "SOLD_OUT", {
      dropId: input.dropId,
      tier: input.tier
    });
  }

  const remainingInventory = Number(decrementResult.rows[0].remaining_inventory);
  const newBalance = input.balance - input.price;

  await input.trackedQuery("UPDATE users SET balance = $1 WHERE id = $2", [newBalance, input.userId]);

  return {
    remainingInventory,
    statementElapsedMs: Number(decrementResult.rows[0].statement_elapsed_ms),
    newBalance
  };
}

async function insertPackRow(input: {
  userId: string;
  dropPackId: string;
  tier: PackTier;
  price: number;
  generationVersionId: string;
  trackedQuery: TrackedQuery;
}): Promise<{ packId: string; purchasedAt: string }> {
  const packResult = await input.trackedQuery<{ id: string; purchased_at: string }>(
    `INSERT INTO packs (user_id, drop_pack_id, tier, price_paid, generation_version_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, purchased_at`,
    [input.userId, input.dropPackId, input.tier, input.price, input.generationVersionId]
  );

  return {
    packId: packResult.rows[0].id,
    purchasedAt: packResult.rows[0].purchased_at
  };
}

async function loadPinnedGenerationVersion(input: {
  trackedClient: Queryable;
  generationVersionId: string;
  dropId: string;
  tier: PackTier;
}): Promise<NonNullable<Awaited<ReturnType<typeof getGenerationVersionById>>>> {
  const generationVersion = await getGenerationVersionById(input.trackedClient, input.generationVersionId);
  if (!generationVersion) {
    throw new DropServiceError("Pinned generation version could not be loaded.", 500, "GENERATION_VERSION_MISSING", {
      dropId: input.dropId,
      tier: input.tier,
      generationVersionId: input.generationVersionId
    });
  }

  return generationVersion;
}

async function prepareFairnessCommitment(input: {
  trackedClient: Queryable;
  trackedQuery: TrackedQuery;
  dropId: string;
  packId: string;
}): Promise<FairnessCommitmentResult> {
  const serverSeed = await lockUnrevealedServerSeed(input.trackedClient, input.dropId);
  if (!serverSeed) {
    throw new DropServiceError("Server seed is unavailable for this active drop.", 500, "SEED_NOT_AVAILABLE", {
      dropId: input.dropId
    });
  }

  let nonce: bigint;
  try {
    nonce = await allocateServerSeedNonce(input.trackedClient, serverSeed.id);
  } catch (error) {
    throw new DropServiceError("Failed to allocate deterministic nonce.", 500, "NONCE_ALLOCATION_FAILED", {
      dropId: input.dropId,
      serverSeedId: serverSeed.id,
      reason: error instanceof Error ? error.message : "unknown"
    });
  }

  const clientSeed = randomBytes(16).toString("hex");
  await input.trackedQuery(
    `INSERT INTO pack_commitments (
       pack_id,
       server_seed_id,
       server_seed_hash_at_commit,
       client_seed,
       nonce
     )
     VALUES ($1, $2, $3, $4, $5)`,
    [input.packId, serverSeed.id, serverSeed.seed_hash, clientSeed, nonce.toString()]
  );

  let serverSeedHex: string;
  try {
    serverSeedHex = decryptServerSeed({
      seedValueCiphertext: serverSeed.seed_value_ciphertext,
      seedIv: serverSeed.seed_iv,
      seedAuthTag: serverSeed.seed_auth_tag,
      seedHash: serverSeed.seed_hash
    });
  } catch (error) {
    throw new DropServiceError("Server seed decryption failed for active drop.", 500, "SEED_NOT_AVAILABLE", {
      dropId: input.dropId,
      serverSeedId: serverSeed.id,
      reason: error instanceof Error ? error.message : "unknown"
    });
  }

  return {
    serverSeedId: serverSeed.id,
    nonce,
    clientSeed,
    serverSeedHex
  };
}

async function generateAndPersistPackCards(input: {
  trackedClient: Queryable;
  tier: PackTier;
  packId: string;
  ownerId: string;
  generationPayload: Parameters<typeof generatePackCards>[0]["generationVersion"];
  serverSeedHex: string;
  clientSeedHex: string;
  nonce: bigint;
  observability: PurchaseObservability;
}): Promise<Awaited<ReturnType<typeof insertPackCardsBulk>>> {
  const deterministicGenerateStartedAtMs = nowMs();
  const { slotPlan, expectedSlotCount } = await generatePackCards({
    tier: input.tier,
    generationVersion: input.generationPayload,
    serverSeedHex: input.serverSeedHex,
    clientSeedHex: input.clientSeedHex,
    nonce: input.nonce
  });
  input.observability.deterministicGenerateMs += nowMs() - deterministicGenerateStartedAtMs;
  input.observability.expectedSlotCount = expectedSlotCount;
  input.observability.uniqueSelectedCardCount = new Set(slotPlan.map((entry) => entry.pokemonCardId)).size;

  const hydrateCardsBatchStartedAtMs = nowMs();
  const hydratedCards = await hydrateCardsForSlotPlan(slotPlan, input.trackedClient);
  input.observability.hydrateCardsBatchMs += nowMs() - hydrateCardsBatchStartedAtMs;

  const generatedCards = materializeGeneratedCards({
    tier: input.tier,
    slotPlan,
    hydratedByCardId: hydratedCards,
    expectedSlotCount
  });

  const cardsBulkInsertStartedAtMs = nowMs();
  const insertedCards = await insertPackCardsBulk(
    {
      packId: input.packId,
      ownerId: input.ownerId,
      cards: generatedCards
    },
    input.trackedClient
  );
  input.observability.cardsBulkInsertMs += nowMs() - cardsBulkInsertStartedAtMs;
  input.observability.insertedCardCount = insertedCards.length;

  return insertedCards;
}

async function recordPackPurchaseLedger(input: {
  trackedQuery: TrackedQuery;
  userId: string;
  packId: string;
  tier: PackTier;
  price: number;
  newBalance: number;
  packMargin: number;
}): Promise<{ marginIncidentFromRevenueInsert: boolean }> {
  await input.trackedQuery(
    `INSERT INTO transactions (user_id, type, amount, reference_id, balance_after)
     VALUES ($1, 'pack_purchase', $2, $3, $4)`,
    [input.userId, -input.price, input.packId, input.newBalance]
  );

  const revenueInsert = await input.trackedQuery<{ inserted_pack_margin: string }>(
    `INSERT INTO platform_revenue (type, amount, reference_id)
     VALUES ('pack_margin', $1, $2)
     RETURNING amount::BIGINT AS inserted_pack_margin`,
    [input.packMargin, input.packId]
  );

  const insertedPackMargin = Number(revenueInsert.rows[0]?.inserted_pack_margin ?? input.packMargin);
  return {
    marginIncidentFromRevenueInsert: isPackMarginOutsideTargetBand({
      tier: input.tier,
      priceCents: input.price,
      packMarginCents: insertedPackMargin
    })
  };
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
       WHERE d.status <> 'draft'
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

export async function listPublicDropsByStatus(statuses: DropStatus[], limit = 20): Promise<DropView[]> {
  const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const normalizedStatuses = [...new Set(statuses)];

  if (normalizedStatuses.length === 0) {
    return [];
  }

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
       WHERE d.status::text = ANY($1::text[])
       ORDER BY CASE d.status
                  WHEN 'upcoming' THEN 0
                  WHEN 'active' THEN 1
                  WHEN 'completed' THEN 2
                  WHEN 'cancelled' THEN 3
                  ELSE 4
                END,
                CASE WHEN d.status = 'upcoming' THEN d.scheduled_at END ASC,
                CASE WHEN d.status <> 'upcoming' THEN d.scheduled_at END DESC,
                dp.tier ASC
       LIMIT $2`,
      [normalizedStatuses, normalizedLimit * 3]
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
         AND d.status <> 'draft'
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
  const purchaseStartedAtMs = nowMs();
  const cachedRemaining = await readCachedInventory(input.dropId, input.tier);
  const observability: PurchaseObservability = {
    cacheSoldOutHint: cachedRemaining !== null && cachedRemaining <= 0,
    queryCount: 0,
    txDurationMs: 0,
    inventoryConsumeRoundtripMs: null,
    generationContextLoadMs: 0,
    deterministicGenerateMs: 0,
    hydrateCardsBatchMs: 0,
    cardsBulkInsertMs: 0,
    expectedSlotCount: 0,
    uniqueSelectedCardCount: 0,
    insertedCardCount: 0,
    outcome: "success",
    errorCode: null
  };

  try {
    const purchase = await withTransaction(async (client) => {
      const trackedQuery = createTrackedQuery(client, observability);
      const trackedClient: Queryable = {
        query: trackedQuery
      };

      const purchaseContext = await loadPurchaseContext(input, trackedQuery);
      const inventoryResult = await consumeInventoryAndChargeBalance({
        userId: input.userId,
        dropId: input.dropId,
        tier: input.tier,
        dropPackId: purchaseContext.dropPackId,
        balance: purchaseContext.balance,
        price: purchaseContext.price,
        trackedQuery
      });
      observability.inventoryConsumeRoundtripMs = inventoryResult.statementElapsedMs;

      const packRow = await insertPackRow({
        userId: input.userId,
        dropPackId: purchaseContext.dropPackId,
        tier: input.tier,
        price: purchaseContext.price,
        generationVersionId: purchaseContext.generationVersionId,
        trackedQuery
      });

      const generationContextStartedAtMs = nowMs();
      const generationVersion = await loadPinnedGenerationVersion({
        trackedClient,
        generationVersionId: purchaseContext.generationVersionId,
        dropId: input.dropId,
        tier: input.tier
      });
      observability.generationContextLoadMs += nowMs() - generationContextStartedAtMs;

      const fairnessCommitment = await prepareFairnessCommitment({
        trackedClient,
        trackedQuery,
        dropId: input.dropId,
        packId: packRow.packId
      });

      const insertedCards = await generateAndPersistPackCards({
        trackedClient,
        tier: input.tier,
        packId: packRow.packId,
        ownerId: input.userId,
        generationPayload: generationVersion.payload,
        serverSeedHex: fairnessCommitment.serverSeedHex,
        clientSeedHex: fairnessCommitment.clientSeed,
        nonce: fairnessCommitment.nonce,
        observability
      });

      const totalCardValue = insertedCards.reduce((sum, card) => sum + card.acquisitionPrice, 0);
      const packMargin = purchaseContext.price - totalCardValue;

      const ledgerResult = await recordPackPurchaseLedger({
        trackedQuery,
        userId: input.userId,
        packId: packRow.packId,
        tier: input.tier,
        price: purchaseContext.price,
        newBalance: inventoryResult.newBalance,
        packMargin
      });

      return {
        packId: packRow.packId,
        dropId: input.dropId,
        dropPackId: purchaseContext.dropPackId,
        tier: input.tier,
        pricePaid: purchaseContext.price,
        remainingInventory: inventoryResult.remainingInventory,
        purchasedAt: packRow.purchasedAt,
        cardsCount: insertedCards.length,
        newBalance: inventoryResult.newBalance,
        marginIncidentFromRevenueInsert: ledgerResult.marginIncidentFromRevenueInsert
      };
    });

    await syncDropInventoryCacheOnPurchase({
      dropId: purchase.dropId,
      tier: purchase.tier,
      remainingInventory: purchase.remainingInventory
    });

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

    if (purchase.marginIncidentFromRevenueInsert) {
      writeSecurityEventFireAndForget({
        eventType: "margin_incident",
        userId: input.userId,
        evidence: {
          packId: purchase.packId,
          dropId: purchase.dropId,
          tier: purchase.tier,
          pricePaid: purchase.pricePaid,
          remainingInventory: purchase.remainingInventory
        }
      });
      emitAdminMetricsDeltaFireAndForget({ marginIncidentCountDelta: 1 });
    }

    observability.outcome = "success";
    return {
      packId: purchase.packId,
      dropId: purchase.dropId,
      dropPackId: purchase.dropPackId,
      tier: purchase.tier,
      pricePaid: purchase.pricePaid,
      remainingInventory: purchase.remainingInventory,
      purchasedAt: purchase.purchasedAt,
      cardsCount: purchase.cardsCount,
      newBalance: purchase.newBalance
    };
  } catch (error) {
    observability.outcome = "error";
    observability.errorCode =
      typeof error === "object" && error && "code" in error ? String((error as { code?: string }).code ?? "") || null : null;
    throw error;
  } finally {
    observability.txDurationMs = nowMs() - purchaseStartedAtMs;
    const basePayload = {
      dropId: input.dropId,
      tier: input.tier,
      userId: input.userId,
      outcome: observability.outcome,
      errorCode: observability.errorCode
    };

    emitPurchaseObservability("purchase_pack", {
      ...basePayload,
      tx_duration_ms: Number(observability.txDurationMs.toFixed(3)),
      query_count: observability.queryCount,
      cache_sold_out_hint: observability.cacheSoldOutHint,
      rejection_precedence_rule: "inventory_first",
      ...buildInventoryConsumeTelemetry({
        statementElapsedMs: observability.inventoryConsumeRoundtripMs
      })
    });
    emitPurchaseObservability("generation_context_load", {
      ...basePayload,
      duration_ms: Number(observability.generationContextLoadMs.toFixed(3))
    });
    emitPurchaseObservability("deterministic_generate", {
      ...basePayload,
      duration_ms: Number(observability.deterministicGenerateMs.toFixed(3)),
      expected_slot_count: observability.expectedSlotCount,
      unique_selected_card_count: observability.uniqueSelectedCardCount
    });
    emitPurchaseObservability("hydrate_cards_batch", {
      ...basePayload,
      duration_ms: Number(observability.hydrateCardsBatchMs.toFixed(3)),
      unique_selected_card_count: observability.uniqueSelectedCardCount
    });
    emitPurchaseObservability("cards_bulk_insert", {
      ...basePayload,
      duration_ms: Number(observability.cardsBulkInsertMs.toFixed(3)),
      inserted_card_count: observability.insertedCardCount
    });
  }
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
