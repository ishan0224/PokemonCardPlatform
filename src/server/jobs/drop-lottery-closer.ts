import {
  DROP_LOTTERY_CLOSER_ENABLED,
  DROP_LOTTERY_RECONCILE_INTERVAL_MS
} from "../config/constants";
import {
  DropLotteryUnavailableError,
  ensureDropLotteryClosedIfDue,
  listActiveDropLotteryWindows
} from "../services/drop-lottery.service";
import type { JobStopper } from "./price-poller";

type DropCloseSchedule = {
  activationMsHint: number;
  closeAtMs: number | null;
  timer: NodeJS.Timeout | null;
  evaluationRunning: boolean;
  settled: boolean;
};

export function startDropLotteryCloser(): JobStopper {
  if (!DROP_LOTTERY_CLOSER_ENABLED) {
    console.log("[drop-lottery-closer] Disabled by DROP_LOTTERY_CLOSER_ENABLED=false.");
    return async () => {};
  }

  const dropSchedules = new Map<string, DropCloseSchedule>();
  let reconcileRunning = false;
  let lotteryUnavailableWarned = false;

  const warnLotteryUnavailable = (): void => {
    if (lotteryUnavailableWarned) {
      return;
    }

    console.warn("[drop-lottery-closer] Lottery unavailable. Waiting-room closer is disabled.");
    lotteryUnavailableWarned = true;
  };

  const clearDropScheduleTimer = (schedule: DropCloseSchedule): void => {
    if (!schedule.timer) {
      return;
    }

    clearTimeout(schedule.timer);
    schedule.timer = null;
  };

  const clearDropSchedule = (dropId: string): void => {
    const schedule = dropSchedules.get(dropId);
    if (!schedule) {
      return;
    }

    clearDropScheduleTimer(schedule);
    dropSchedules.delete(dropId);
  };

  const scheduleDropEvaluationAt = (dropId: string, closeAtMs: number): void => {
    const schedule = dropSchedules.get(dropId);
    if (!schedule) {
      return;
    }

    if (schedule.timer && schedule.closeAtMs === closeAtMs) {
      return;
    }

    clearDropScheduleTimer(schedule);

    const delayMs = Math.max(Math.trunc(closeAtMs - Date.now()), 0);
    schedule.timer = setTimeout(() => {
      const tracked = dropSchedules.get(dropId);
      if (tracked) {
        tracked.timer = null;
      }

      void evaluateDropClose(dropId);
    }, delayMs);
  };

  const applyCloseResult = (dropId: string, closeAtMs: number | null, settled: boolean): void => {
    const schedule = dropSchedules.get(dropId);
    if (!schedule) {
      return;
    }

    schedule.closeAtMs = closeAtMs;
    schedule.settled = settled;

    if (closeAtMs !== null && !settled) {
      scheduleDropEvaluationAt(dropId, closeAtMs);
      return;
    }

    clearDropScheduleTimer(schedule);
  };

  const evaluateDropClose = async (dropId: string): Promise<void> => {
    const schedule = dropSchedules.get(dropId);
    if (!schedule || schedule.evaluationRunning) {
      return;
    }

    schedule.evaluationRunning = true;
    try {
      const closeResult = await ensureDropLotteryClosedIfDue({
        dropId,
        activationMsHint: schedule.activationMsHint
      });

      if (closeResult.status === "not_due") {
        applyCloseResult(dropId, closeResult.closeAtMs, false);
        return;
      }

      if (closeResult.status === "closed" || closeResult.status === "already_closed") {
        applyCloseResult(dropId, closeResult.closeAtMs, true);
        return;
      }

      applyCloseResult(dropId, null, true);
    } catch (error) {
      if (error instanceof DropLotteryUnavailableError) {
        warnLotteryUnavailable();
        return;
      }

      const typed = error as { message?: string };
      console.warn(`[drop-lottery-closer] Drop ${dropId} evaluate failed: ${typed.message ?? "unknown error"}`);
    } finally {
      const tracked = dropSchedules.get(dropId);
      if (tracked) {
        tracked.evaluationRunning = false;
      }
    }
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
        const existing = dropSchedules.get(drop.dropId);
        if (!existing) {
          dropSchedules.set(drop.dropId, {
            activationMsHint: drop.activationMsHint,
            closeAtMs: null,
            timer: null,
            evaluationRunning: false,
            settled: false
          });
          void evaluateDropClose(drop.dropId);
          continue;
        }

        existing.activationMsHint = drop.activationMsHint;
        if (!existing.settled && !existing.evaluationRunning && !existing.timer) {
          void evaluateDropClose(drop.dropId);
        }
      }

      for (const trackedDropId of dropSchedules.keys()) {
        if (!activeIds.has(trackedDropId)) {
          clearDropSchedule(trackedDropId);
        }
      }
    } catch (error) {
      if (error instanceof DropLotteryUnavailableError) {
        warnLotteryUnavailable();
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
  }, DROP_LOTTERY_RECONCILE_INTERVAL_MS);

  return async () => {
    clearInterval(reconcileTimer);
    for (const schedule of dropSchedules.values()) {
      clearDropScheduleTimer(schedule);
    }
    dropSchedules.clear();
  };
}
