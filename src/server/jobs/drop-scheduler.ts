import type { PackTier } from "../../lib/types";
import type { QueryResult, QueryResultRow } from "pg";
import {
  DROP_INVENTORY_RECONCILE_ENABLED,
  DROP_INVENTORY_RECONCILE_INTERVAL_MS,
  DROP_SCHEDULER_INTERVAL_MS
} from "../config/constants";
import { query, withTransaction } from "../db/pool";
import { getIO } from "../websocket/io";
import { roomNames } from "../websocket/rooms";
import type { JobStopper } from "./price-poller";
import {
  syncDropInventoryCache,
  syncDropInventoryCacheOnDropComplete,
  syncDropInventoryCacheOnDropStart
} from "../services/drop.service";
import { createEncryptedServerSeed, ensureNonceCounterRow } from "../services/fairness.service";
import { getLatestGenerationVersion } from "../services/pack-generation-version.service";
import { initializeDropLotteryActivation } from "../services/drop-lottery.service";

async function waitForTickDrain(isRunning: () => boolean): Promise<void> {
  while (isRunning()) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
  }
}

type TierInventoryRow = {
  tier: PackTier;
  remaining_inventory: number;
};

async function listTierInventoryForDrop(dropId: string): Promise<TierInventoryRow[]> {
  const result = await query<{ tier: PackTier; remaining_inventory: number }>(
    "SELECT tier, remaining_inventory FROM drop_packs WHERE drop_id = $1 ORDER BY tier ASC",
    [dropId]
  );

  return result.rows.map((row) => ({
    tier: row.tier,
    remaining_inventory: Number(row.remaining_inventory)
  }));
}

function emitDropEvent(dropId: string, event: string, payload: Record<string, unknown>): void {
  try {
    const io = getIO();
    io.to(roomNames.drop(dropId)).emit(event, payload);
  } catch (_error) {
    // Socket server may be unavailable in script-only contexts.
  }
}

async function listDueDropIds(): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `SELECT id
     FROM drops
     WHERE status = 'upcoming'
       AND scheduled_at <= now()
     ORDER BY scheduled_at ASC`
  );

  return rows.rows.map((row) => row.id);
}

type LockedDropRow = {
  id: string;
  status: string;
  active_generation_version_id: string | null;
};

type SchedulerQueryable = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
};

let lastInventoryReconcileAtMs = 0;

async function ensureDropGenerationVersion(
  client: SchedulerQueryable,
  dropId: string,
  activeGenerationVersionId: string | null,
  fallbackGenerationVersionId: string
): Promise<void> {
  if (activeGenerationVersionId) {
    return;
  }

  await client.query(
    `UPDATE drops
     SET active_generation_version_id = $2
     WHERE id = $1`,
    [dropId, fallbackGenerationVersionId]
  );
}

async function ensureDropServerSeedAndNonce(client: SchedulerQueryable, dropId: string): Promise<void> {
  const existingSeed = await client.query<{ id: string }>(
    `SELECT id
     FROM server_seeds
     WHERE drop_id = $1
       AND revealed_at IS NULL
     FOR UPDATE`,
    [dropId]
  );

  if (existingSeed.rowCount === 1) {
    await ensureNonceCounterRow(client, existingSeed.rows[0].id);
    return;
  }

  const encryptedSeed = createEncryptedServerSeed();
  const insertedSeed = await client.query<{ id: string }>(
    `INSERT INTO server_seeds (
       drop_id,
       seed_hash,
       seed_value_ciphertext,
       seed_iv,
       seed_auth_tag
     )
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [dropId, encryptedSeed.seedHash, encryptedSeed.ciphertext, encryptedSeed.iv, encryptedSeed.authTag]
  );

  await ensureNonceCounterRow(client, insertedSeed.rows[0].id);
}

async function ensureDropFairnessArtifacts(
  client: SchedulerQueryable,
  lockedDrop: LockedDropRow,
  fallbackGenerationVersionId: string
): Promise<void> {
  await ensureDropGenerationVersion(
    client,
    lockedDrop.id,
    lockedDrop.active_generation_version_id,
    fallbackGenerationVersionId
  );
  await ensureDropServerSeedAndNonce(client, lockedDrop.id);
}

async function resolveLatestGenerationVersionId(): Promise<string | null> {
  return withTransaction(async (client) => {
    const latestGenerationVersion = await getLatestGenerationVersion(client);
    return latestGenerationVersion?.id ?? null;
  });
}

async function activateDropWithFairnessSetup(dropId: string, fallbackGenerationVersionId: string): Promise<boolean> {
  return withTransaction(async (client) => {
    const lockedDrop = await client.query<LockedDropRow>(
      `SELECT id, status, active_generation_version_id
       FROM drops
       WHERE id = $1
       FOR UPDATE`,
      [dropId]
    );

    if (lockedDrop.rowCount !== 1 || lockedDrop.rows[0].status !== "upcoming") {
      return false;
    }

    await client.query(
      `UPDATE drops
       SET status = 'active'
       WHERE id = $1`,
      [dropId]
    );

    await ensureDropFairnessArtifacts(client, lockedDrop.rows[0], fallbackGenerationVersionId);
    return true;
  });
}

async function ensureActiveDropFairnessSetup(dropId: string, fallbackGenerationVersionId: string): Promise<void> {
  await withTransaction(async (client) => {
    const lockedDrop = await client.query<LockedDropRow>(
      `SELECT id, status, active_generation_version_id
       FROM drops
       WHERE id = $1
       FOR UPDATE`,
      [dropId]
    );

    if (lockedDrop.rowCount !== 1 || lockedDrop.rows[0].status !== "active") {
      return;
    }

    await ensureDropFairnessArtifacts(client, lockedDrop.rows[0], fallbackGenerationVersionId);
  });
}

async function activateDueDrops(fallbackGenerationVersionId: string): Promise<string[]> {
  const dueDropIds = await listDueDropIds();
  const activated: string[] = [];

  for (const dropId of dueDropIds) {
    const activatedThisDrop = await activateDropWithFairnessSetup(dropId, fallbackGenerationVersionId);
    if (activatedThisDrop) {
      activated.push(dropId);
    }
  }

  return activated;
}

async function completeSoldOutDrops(): Promise<string[]> {
  return withTransaction(async (client) => {
    const completed = await client.query<{ id: string }>(
      `UPDATE drops d
       SET status = 'completed'
       WHERE d.status = 'active'
         AND NOT EXISTS (
           SELECT 1
           FROM drop_packs dp
           WHERE dp.drop_id = d.id
             AND dp.remaining_inventory > 0
         )
       RETURNING d.id`
    );

    const completedDropIds = completed.rows.map((row) => row.id);
    if (completedDropIds.length > 0) {
      await client.query(
        `UPDATE server_seeds
         SET revealed_at = now()
         WHERE drop_id = ANY($1::uuid[])
           AND revealed_at IS NULL`,
        [completedDropIds]
      );
    }

    return completedDropIds;
  });
}

async function syncActiveDropInventoryCache(): Promise<void> {
  const activeDrops = await query<{ id: string }>("SELECT id FROM drops WHERE status = 'active'");

  for (const row of activeDrops.rows) {
    await syncDropInventoryCache(row.id);
  }
}

async function maybeRunInventoryReconcileSafetyNet(): Promise<void> {
  if (!DROP_INVENTORY_RECONCILE_ENABLED) {
    return;
  }

  const nowMs = Date.now();
  if (
    lastInventoryReconcileAtMs !== 0 &&
    nowMs - lastInventoryReconcileAtMs < DROP_INVENTORY_RECONCILE_INTERVAL_MS
  ) {
    return;
  }

  await syncActiveDropInventoryCache();
  lastInventoryReconcileAtMs = nowMs;
}

async function runSchedulerTick(): Promise<void> {
  const fallbackGenerationVersionId = await resolveLatestGenerationVersionId();
  if (!fallbackGenerationVersionId) {
    console.error(
      "[drop-scheduler] SKIP_ACTIVATION_NO_GENERATION_VERSION: no pack_generation_versions row found. " +
        "Run `npm run partb:phase0:backfill` before activating drops."
    );

    await maybeRunInventoryReconcileSafetyNet();

    const completedDropIds = await completeSoldOutDrops();
    for (const dropId of completedDropIds) {
      await syncDropInventoryCacheOnDropComplete(dropId);
      emitDropEvent(dropId, "drop_completed", {
        dropId,
        completedAt: new Date().toISOString()
      });

      console.log(`[drop-scheduler] Completed drop ${dropId}`);
    }

    return;
  }

  const activeDrops = await query<{ id: string }>("SELECT id FROM drops WHERE status = 'active'");
  for (const row of activeDrops.rows) {
    await ensureActiveDropFairnessSetup(row.id, fallbackGenerationVersionId);
    await initializeDropLotteryActivation(row.id);
  }

  await maybeRunInventoryReconcileSafetyNet();

  const activatedDropIds = await activateDueDrops(fallbackGenerationVersionId);

  for (const dropId of activatedDropIds) {
    await initializeDropLotteryActivation(dropId);
    await syncDropInventoryCacheOnDropStart(dropId);

    emitDropEvent(dropId, "drop_started", {
      dropId,
      startedAt: new Date().toISOString()
    });

    const inventoryRows = await listTierInventoryForDrop(dropId);

    for (const row of inventoryRows) {
      emitDropEvent(dropId, "inventory_update", {
        dropId,
        tier: row.tier,
        remainingInventory: row.remaining_inventory
      });
    }

    console.log(`[drop-scheduler] Activated drop ${dropId}`);
  }

  const completedDropIds = await completeSoldOutDrops();

  for (const dropId of completedDropIds) {
    await syncDropInventoryCacheOnDropComplete(dropId);
    emitDropEvent(dropId, "drop_completed", {
      dropId,
      completedAt: new Date().toISOString()
    });

    console.log(`[drop-scheduler] Completed drop ${dropId}`);
  }
}

export function startDropScheduler(): JobStopper {
  let running = false;
  lastInventoryReconcileAtMs = 0;

  const executeTick = async (): Promise<void> => {
    if (running) {
      return;
    }

    running = true;

    try {
      await runSchedulerTick();
    } catch (error) {
      console.error("[drop-scheduler] Tick failed:", error);
    } finally {
      running = false;
    }
  };

  void executeTick();

  const timer = setInterval(() => {
    void executeTick();
  }, DROP_SCHEDULER_INTERVAL_MS);

  return async () => {
    clearInterval(timer);
    await waitForTickDrain(() => running);
  };
}
