import { FAIRNESS_AUDITOR_ENABLED, FAIRNESS_AUDITOR_INTERVAL_MS } from "../config/constants";
import { runNightlyFairnessAuditIfDue } from "../services/fairness-audit.service";
import type { JobStopper } from "./price-poller";

async function waitForTickDrain(isRunning: () => boolean): Promise<void> {
  while (isRunning()) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25);
    });
  }
}

export function startFairnessAuditor(): JobStopper {
  if (!FAIRNESS_AUDITOR_ENABLED) {
    return async () => {};
  }

  let running = false;

  const runTick = async (): Promise<void> => {
    if (running) {
      return;
    }

    running = true;
    try {
      const result = await runNightlyFairnessAuditIfDue();
      if (result) {
        console.log(
          `[fairness-auditor] nightly audit complete p=${result.pValue.toFixed(6)} sampleSize=${result.sampleSize}`
        );
      }
    } catch (error) {
      const typed = error as { message?: string };
      console.warn(`[fairness-auditor] tick failed: ${typed.message ?? "unknown error"}`);
    } finally {
      running = false;
    }
  };

  void runTick();

  const timer = setInterval(() => {
    void runTick();
  }, FAIRNESS_AUDITOR_INTERVAL_MS);

  return async () => {
    clearInterval(timer);
    await waitForTickDrain(() => running);
  };
}
