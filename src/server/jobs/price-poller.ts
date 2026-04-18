import { PRICE_POLLER_INTERVAL_MS } from "../config/constants";
import { pollPriceBatch, type PollPriceCursor } from "../services/price.service";

export type JobStopper = () => Promise<void>;

export function startPricePoller(): JobStopper {
  let running = false;
  let cursor: PollPriceCursor = {
    catalogCursor: null,
    ownedCursor: null
  };

  const executeTick = async (): Promise<void> => {
    if (running) {
      return;
    }

    running = true;

    try {
      const result = await pollPriceBatch(cursor);
      cursor = result.nextCursor;

      if (result.changedCards > 0) {
        console.log(
          `[price-poller] scanned=${result.scannedCards} changed=${result.changedCards} notifiedUsers=${result.emittedUsers}${result.wrapped ? " wrapped=true" : ""}`
        );
      }
    } catch (error) {
      console.error("[price-poller] Tick failed:", error);
    } finally {
      running = false;
    }
  };

  void executeTick();

  const timer = setInterval(() => {
    void executeTick();
  }, PRICE_POLLER_INTERVAL_MS);

  return async () => {
    clearInterval(timer);
  };
}
