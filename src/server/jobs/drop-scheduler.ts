import { DROP_SCHEDULER_INTERVAL_MS } from "../config/constants";
import type { JobStopper } from "./price-poller";

export function startDropScheduler(): JobStopper {
  const timer = setInterval(() => {
    // Phase 1 stub: job wiring only. Implementation starts in later phases.
  }, DROP_SCHEDULER_INTERVAL_MS);

  return async () => {
    clearInterval(timer);
  };
}
