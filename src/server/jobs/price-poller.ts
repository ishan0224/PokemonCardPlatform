import { PRICE_POLLER_INTERVAL_MS } from "../config/constants";

export type JobStopper = () => Promise<void>;

export function startPricePoller(): JobStopper {
  const timer = setInterval(() => {
    // Phase 1 stub: job wiring only. Implementation starts in later phases.
  }, PRICE_POLLER_INTERVAL_MS);

  return async () => {
    clearInterval(timer);
  };
}
