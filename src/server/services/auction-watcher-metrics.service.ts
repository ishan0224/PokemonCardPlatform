import { query } from "../db/pool";

const SAMPLE_COALESCE_WINDOW_MS = 500;
const SAMPLE_MAX_BUFFER = 200;

type PendingSample = {
  auctionId: string;
  observedCount: number;
  sampledAt: Date;
};

const pendingByAuctionId = new Map<string, PendingSample>();
let flushTimer: NodeJS.Timeout | null = null;
let flushing = false;

function normalizeCount(count: number): number {
  if (!Number.isFinite(count)) {
    return 0;
  }
  return Math.max(0, Math.trunc(count));
}

async function flushPendingSamples(): Promise<void> {
  if (flushing || pendingByAuctionId.size === 0) {
    return;
  }

  flushing = true;
  const samples = Array.from(pendingByAuctionId.values());
  pendingByAuctionId.clear();

  try {
    await query(
      `INSERT INTO auction_watcher_samples (auction_id, observed_count, sampled_at)
       SELECT *
       FROM UNNEST($1::uuid[], $2::int[], $3::timestamptz[])`,
      [
        samples.map((entry) => entry.auctionId),
        samples.map((entry) => entry.observedCount),
        samples.map((entry) => entry.sampledAt.toISOString())
      ]
    );
  } catch (error) {
    const typed = error as { message?: string };
    console.warn(`[auction-watcher-metrics] failed to flush samples: ${typed.message ?? "unknown error"}`);
  } finally {
    flushing = false;
  }
}

function scheduleFlush(): void {
  if (flushTimer) {
    return;
  }

  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPendingSamples();
  }, SAMPLE_COALESCE_WINDOW_MS);
}

export function recordAuctionWatcherSample(auctionId: string, observedCount: number): void {
  const normalizedAuctionId = auctionId.trim();
  if (!normalizedAuctionId) {
    return;
  }

  pendingByAuctionId.set(normalizedAuctionId, {
    auctionId: normalizedAuctionId,
    observedCount: normalizeCount(observedCount),
    sampledAt: new Date()
  });

  if (pendingByAuctionId.size >= SAMPLE_MAX_BUFFER) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    void flushPendingSamples();
    return;
  }

  scheduleFlush();
}

export async function flushAuctionWatcherMetricsSamples(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  await flushPendingSamples();
}
