import {
  DropLotteryUnavailableError,
  ensureDropLotteryClosedIfDue,
  listActiveDropLotteryWindows
} from "../services/drop-lottery.service";
import type { JobStopper } from "./price-poller";

const RECONCILE_INTERVAL_MS = 2_000;
const PER_DROP_TICK_INTERVAL_MS = 250;

export function startDropLotteryCloser(): JobStopper {
  const dropTimers = new Map<string, NodeJS.Timeout>();
  let reconcileRunning = false;
  let lotteryUnavailableWarned = false;

  const clearDropTimer = (dropId: string): void => {
    const timer = dropTimers.get(dropId);
    if (!timer) {
      return;
    }

    clearInterval(timer);
    dropTimers.delete(dropId);
  };

  const runDropTick = async (dropId: string, activationMsHint: number): Promise<void> => {
    try {
      const closeResult = await ensureDropLotteryClosedIfDue({
        dropId,
        activationMsHint
      });

      if (closeResult.status === "closed" || closeResult.status === "already_closed" || closeResult.status === "inactive") {
        clearDropTimer(dropId);
      }
    } catch (error) {
      if (error instanceof DropLotteryUnavailableError) {
        if (!lotteryUnavailableWarned) {
          console.warn("[drop-lottery-closer] Lottery unavailable. Waiting-room closer is disabled.");
          lotteryUnavailableWarned = true;
        }
        return;
      }

      const typed = error as { message?: string };
      console.warn(`[drop-lottery-closer] Drop ${dropId} tick failed: ${typed.message ?? "unknown error"}`);
    }
  };

  const ensureDropTimer = (dropId: string, activationMsHint: number): void => {
    if (dropTimers.has(dropId)) {
      return;
    }

    const timer = setInterval(() => {
      void runDropTick(dropId, activationMsHint);
    }, PER_DROP_TICK_INTERVAL_MS);

    dropTimers.set(dropId, timer);
  };

  const reconcileActiveDrops = async (): Promise<void> => {
    if (reconcileRunning) {
      return;
    }

    reconcileRunning = true;
    try {
      const activeDrops = await listActiveDropLotteryWindows();
      const activeIds = new Set(activeDrops.map((row) => row.dropId));

      for (const drop of activeDrops) {
        ensureDropTimer(drop.dropId, drop.activationMsHint);
      }

      for (const trackedDropId of dropTimers.keys()) {
        if (!activeIds.has(trackedDropId)) {
          clearDropTimer(trackedDropId);
        }
      }
    } catch (error) {
      if (error instanceof DropLotteryUnavailableError) {
        if (!lotteryUnavailableWarned) {
          console.warn("[drop-lottery-closer] Lottery unavailable. Waiting-room closer is disabled.");
          lotteryUnavailableWarned = true;
        }
      } else {
        const typed = error as { message?: string };
        console.warn(`[drop-lottery-closer] Reconcile failed: ${typed.message ?? "unknown error"}`);
      }
    } finally {
      reconcileRunning = false;
    }
  };

  void reconcileActiveDrops();

  const reconcileTimer = setInterval(() => {
    void reconcileActiveDrops();
  }, RECONCILE_INTERVAL_MS);

  return async () => {
    clearInterval(reconcileTimer);
    for (const timer of dropTimers.values()) {
      clearInterval(timer);
    }
    dropTimers.clear();
  };
}
