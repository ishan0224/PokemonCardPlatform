import type { PackTier } from "../../lib/types";
import { DROP_SCHEDULER_INTERVAL_MS } from "../config/constants";
import { query } from "../db/pool";
import { getIO } from "../websocket/io";
import { roomNames } from "../websocket/rooms";
import type { JobStopper } from "./price-poller";
import { syncDropInventoryCache } from "../services/drop.service";

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

async function activateDueDrops(): Promise<string[]> {
  const result = await query<{ id: string }>(
    `UPDATE drops
     SET status = 'active'
     WHERE status = 'upcoming'
       AND scheduled_at <= now()
     RETURNING id`
  );

  return result.rows.map((row) => row.id);
}

async function completeSoldOutDrops(): Promise<string[]> {
  const result = await query<{ id: string }>(
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

  return result.rows.map((row) => row.id);
}

async function syncActiveDropInventoryCache(): Promise<void> {
  const activeDrops = await query<{ id: string }>("SELECT id FROM drops WHERE status = 'active'");

  for (const row of activeDrops.rows) {
    await syncDropInventoryCache(row.id);
  }
}

async function runSchedulerTick(): Promise<void> {
  await syncActiveDropInventoryCache();

  const activatedDropIds = await activateDueDrops();

  for (const dropId of activatedDropIds) {
    await syncDropInventoryCache(dropId);

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
    emitDropEvent(dropId, "drop_completed", {
      dropId,
      completedAt: new Date().toISOString()
    });

    console.log(`[drop-scheduler] Completed drop ${dropId}`);
  }
}

export function startDropScheduler(): JobStopper {
  let running = false;

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
  };
}
