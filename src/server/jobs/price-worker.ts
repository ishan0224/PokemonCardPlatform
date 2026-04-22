import {
  PRICE_JOB_ACTIVITY_LOGS_ENABLED,
  PRICE_JOB_RETRY_BASE_DELAY_MS,
  PRICE_JOB_RETRY_MAX_DELAY_MS,
  PRICE_WORKER_LOCK_TIMEOUT_MS,
  PRICE_WORKER_POLL_INTERVAL_MS,
  PRICE_WORKER_RECOVERY_INTERVAL_MS
} from "../config/constants";
import {
  claimNextPriceUpdateJob,
  markPriceUpdateJobCompleted,
  markPriceUpdateJobRetryOrFailed,
  recoverStaleRunningPriceUpdateJobs
} from "../services/price-queue.service";
import { processPriceBatchByPokemonCardIds } from "../services/price.service";
import { maybeTriggerAutoRebalance } from "../economics/auto-rebalance-coordinator";
import type { JobStopper } from "./price-poller";

async function waitForTickDrain(isRunning: () => boolean): Promise<void> {
  while (isRunning()) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
  }
}

function buildWorkerId(): string {
  return `worker-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
}

function resolveRetryDelayMs(attempts: number): number {
  const safeAttempts = Math.max(Math.trunc(attempts), 0);
  const exponential = PRICE_JOB_RETRY_BASE_DELAY_MS * 2 ** safeAttempts;
  return Math.min(exponential, PRICE_JOB_RETRY_MAX_DELAY_MS);
}

function normalizeErrorMessage(error: unknown): string {
  const typed = error as { message?: string };
  const message = typeof typed?.message === "string" ? typed.message : "Unknown error";
  return message.slice(0, 2_000);
}

export function startPriceWorker(): JobStopper {
  const workerId = buildWorkerId();
  let running = false;
  let lastRecoveryAt = 0;

  const executeTick = async (): Promise<void> => {
    if (running) {
      return;
    }

    running = true;
    try {
      const now = Date.now();
      if (now - lastRecoveryAt >= PRICE_WORKER_RECOVERY_INTERVAL_MS) {
        const recovered = await recoverStaleRunningPriceUpdateJobs(PRICE_WORKER_LOCK_TIMEOUT_MS);
        if (recovered > 0) {
          console.warn(`[price-worker] recoveredStaleJobs=${recovered}`);
        }
        lastRecoveryAt = now;
      }

      const job = await claimNextPriceUpdateJob(workerId);
      if (!job) {
        return;
      }

      try {
        const result = await processPriceBatchByPokemonCardIds(job.payload.pokemonCardIds);
        await markPriceUpdateJobCompleted(job.id);
        void maybeTriggerAutoRebalance().catch((error) => {
          const typed = error as { message?: string };
          console.warn(`[price-worker] auto-rebalance trigger failed: ${typed.message ?? "unknown error"}`);
        });

        if (PRICE_JOB_ACTIVITY_LOGS_ENABLED && result.changedCards > 0) {
          console.log(
            `[price-worker] job=${job.id} scanned=${result.scannedCards} changed=${result.changedCards} notifiedUsers=${result.emittedUsers}`
          );
        }
      } catch (processingError) {
        const retryDelayMs = resolveRetryDelayMs(job.attempts);
        const errorMessage = normalizeErrorMessage(processingError);
        const status = await markPriceUpdateJobRetryOrFailed({
          jobId: job.id,
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
          errorMessage,
          retryDelayMs
        });

        if (status === "failed") {
          console.error(`[price-worker] job=${job.id} failed attempts=${job.attempts + 1} error=${errorMessage}`);
        } else {
          console.warn(
            `[price-worker] job=${job.id} retrying attempts=${job.attempts + 1}/${job.maxAttempts} delayMs=${retryDelayMs} error=${errorMessage}`
          );
        }
      }
    } catch (error) {
      console.error("[price-worker] Tick failed:", error);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void executeTick();
  }, PRICE_WORKER_POLL_INTERVAL_MS);

  void executeTick();

  return async () => {
    clearInterval(timer);
    await waitForTickDrain(() => running);
  };
}
