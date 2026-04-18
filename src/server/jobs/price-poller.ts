import { createHash } from "crypto";
import {
  PRICE_JOB_ACTIVITY_LOGS_ENABLED,
  PRICE_JOB_CHUNK_SIZE,
  PRICE_JOB_KEY_BUCKET_MS,
  PRICE_JOB_MAX_ATTEMPTS,
  PRICE_JOB_OWNED_PRIORITY_QUOTA,
  PRICE_SELECTION_DIAGNOSTICS_ENABLED,
  PRICE_JOB_SELECTION_LIMIT,
  PRICE_SCHEDULER_INTERVAL_MS
} from "../config/constants";
import { enqueuePriceUpdateJobs } from "../services/price-queue.service";
import { selectDuePokemonCardIdsWithDiagnostics } from "../services/price.service";

export type JobStopper = () => Promise<void>;

async function waitForTickDrain(isRunning: () => boolean): Promise<void> {
  while (isRunning()) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
  }
}

function chunkIds(ids: string[], size: number): string[][] {
  const safeSize = Math.max(Math.trunc(size), 1);
  const chunks: string[][] = [];

  for (let index = 0; index < ids.length; index += safeSize) {
    chunks.push(ids.slice(index, index + safeSize));
  }

  return chunks;
}

function buildJobKey(bucketStartMs: number, pokemonCardIds: string[]): string {
  const stableIds = [...pokemonCardIds].sort();
  const digest = createHash("sha256").update(stableIds.join(",")).digest("hex").slice(0, 20);
  return `price:${bucketStartMs}:${digest}`;
}

export function startPricePoller(): JobStopper {
  let running = false;

  const executeTick = async (): Promise<void> => {
    if (running) {
      return;
    }

    running = true;

    try {
      const selection = await selectDuePokemonCardIdsWithDiagnostics(
        PRICE_JOB_SELECTION_LIMIT,
        PRICE_JOB_OWNED_PRIORITY_QUOTA
      );
      const selectedIds = selection.pokemonCardIds;

      if (PRICE_SELECTION_DIAGNOSTICS_ENABLED) {
        console.log(
          `[price-scheduler] selection mode=${selection.diagnostics.mode} limit=${selection.diagnostics.limit} ownedDue=${selection.diagnostics.selectedOwnedDue} ownedNearDue=${selection.diagnostics.selectedOwnedNearDue} catalogDue=${selection.diagnostics.selectedCatalogDue} total=${selection.diagnostics.totalSelected} target=${selection.diagnostics.trialOwnedTarget} nearDueCap=${selection.diagnostics.trialOwnedNearDueCap}`
        );
      }

      if (selectedIds.length === 0) {
        return;
      }

      const chunked = chunkIds(selectedIds, PRICE_JOB_CHUNK_SIZE);
      const now = Date.now();
      const bucketStartMs = now - (now % Math.max(PRICE_JOB_KEY_BUCKET_MS, 1));
      const runAt = new Date(now).toISOString();

      const enqueueResult = await enqueuePriceUpdateJobs(
        chunked.map((pokemonCardIds) => ({
          jobKey: buildJobKey(bucketStartMs, pokemonCardIds),
          runAt,
          maxAttempts: PRICE_JOB_MAX_ATTEMPTS,
          payload: {
            pokemonCardIds,
            bucketStartMs
          }
        }))
      );

      if (PRICE_JOB_ACTIVITY_LOGS_ENABLED && (enqueueResult.enqueued > 0 || enqueueResult.duplicates > 0)) {
        console.log(
          `[price-scheduler] selected=${selectedIds.length} jobs=${chunked.length} enqueued=${enqueueResult.enqueued} duplicates=${enqueueResult.duplicates}`
        );
      }
    } catch (error) {
      console.error("[price-scheduler] Tick failed:", error);
    } finally {
      running = false;
    }
  };

  void executeTick();

  const timer = setInterval(() => {
    void executeTick();
  }, PRICE_SCHEDULER_INTERVAL_MS);

  return async () => {
    clearInterval(timer);
    await waitForTickDrain(() => running);
  };
}
