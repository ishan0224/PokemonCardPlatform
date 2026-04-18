import type { PackTier, RarityTier } from "../../lib/types";

export type PriceSelectionMode = "production" | "trial";

function resolveBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (typeof value !== "string") {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  return defaultValue;
}

function resolveIntegerEnv(value: string | undefined, defaultValue: number): number {
  if (typeof value !== "string") {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  const normalized = Math.trunc(parsed);
  return normalized > 0 ? normalized : defaultValue;
}

function resolvePriceSelectionModeEnv(
  value: string | undefined,
  defaultValue: PriceSelectionMode
): PriceSelectionMode {
  if (typeof value !== "string") {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "production" || normalized === "trial") {
    return normalized;
  }

  return defaultValue;
}

export const PACK_PRICE_CENTS: Record<PackTier, number> = {
  standard: 500,
  premium: 2_000,
  elite: 5_000
};

export const DROP_INVENTORY_DEFAULT: Record<PackTier, number> = {
  standard: 10,
  premium: 5,
  elite: 3
};

export const PER_USER_TIER_LIMIT_PER_DROP = 2;

export const TRADING_FEE_BPS = 500; // 5.00%
export const AUCTION_FEE_BPS = 800; // 8.00%

export const MIN_LISTING_PRICE_CENTS = 50;
export const MIN_AUCTION_START_BID_CENTS = 50;
export const MIN_BID_INCREMENT_CENTS = 50;
export const MIN_BID_INCREMENT_BPS = 500; // 5.00%
export const ANTI_SNIPE_EXTENSION_SECONDS = 30;

export const PRICE_POLLER_INTERVAL_MS = 5 * 60 * 1000;
export const PRICE_POLLER_BATCH_SIZE = 250;
export const PRICE_POLLER_OWNED_PRIORITY_QUOTA = 100;
export const PRICE_CACHE_TTL_SECONDS = 10 * 60;
export const PRICE_SOURCE_TIMEOUT_MS = 15_000;
export const PRICE_SOURCE_BATCH_SIZE = 30;
export const PRICE_SIMULATION_MAX_DRIFT_BPS = 300; // +/-3.00%
export const PRICE_SIMULATION_SET_DRIFT_BPS = 100; // +/-1.00%
export const PRICE_SIMULATION_CAP_BPS = 3_000; // +/-30.00%
export const PRICE_SCHEDULER_ENABLED = resolveBooleanEnv(process.env.PRICE_SCHEDULER_ENABLED, true);
export const PRICE_WORKER_ENABLED = resolveBooleanEnv(process.env.PRICE_WORKER_ENABLED, true);
export const PRICE_COALESCING_ENABLED = resolveBooleanEnv(process.env.PRICE_COALESCING_ENABLED, true);
export const PRICE_SCHEDULER_INTERVAL_MS = resolveIntegerEnv(process.env.PRICE_SCHEDULER_INTERVAL_MS, 60_000);
export const PRICE_WORKER_POLL_INTERVAL_MS = resolveIntegerEnv(process.env.PRICE_WORKER_POLL_INTERVAL_MS, 1_000);
export const PRICE_WORKER_RECOVERY_INTERVAL_MS = resolveIntegerEnv(process.env.PRICE_WORKER_RECOVERY_INTERVAL_MS, 30_000);
export const PRICE_WORKER_LOCK_TIMEOUT_MS = resolveIntegerEnv(process.env.PRICE_WORKER_LOCK_TIMEOUT_MS, 120_000);
export const PRICE_JOB_SELECTION_LIMIT = resolveIntegerEnv(process.env.PRICE_JOB_SELECTION_LIMIT, PRICE_POLLER_BATCH_SIZE);
export const PRICE_JOB_OWNED_PRIORITY_QUOTA = resolveIntegerEnv(
  process.env.PRICE_JOB_OWNED_PRIORITY_QUOTA,
  PRICE_POLLER_OWNED_PRIORITY_QUOTA
);
export const PRICE_SELECTION_MODE = resolvePriceSelectionModeEnv(
  process.env.PRICE_SELECTION_MODE,
  "production"
);
export const PRICE_TRIAL_OWNED_TARGET_PER_TICK = resolveIntegerEnv(
  process.env.PRICE_TRIAL_OWNED_TARGET_PER_TICK,
  PRICE_JOB_OWNED_PRIORITY_QUOTA
);
export const PRICE_TRIAL_OWNED_NEAR_DUE_CAP = resolveIntegerEnv(
  process.env.PRICE_TRIAL_OWNED_NEAR_DUE_CAP,
  Math.max(Math.trunc(PRICE_JOB_OWNED_PRIORITY_QUOTA / 2), 1)
);
export const PRICE_SELECTION_DIAGNOSTICS_ENABLED = resolveBooleanEnv(
  process.env.PRICE_SELECTION_DIAGNOSTICS_ENABLED,
  false
);
export const PRICE_JOB_CHUNK_SIZE = resolveIntegerEnv(process.env.PRICE_JOB_CHUNK_SIZE, 50);
export const PRICE_JOB_MAX_ATTEMPTS = resolveIntegerEnv(process.env.PRICE_JOB_MAX_ATTEMPTS, 5);
export const PRICE_JOB_RETRY_BASE_DELAY_MS = resolveIntegerEnv(process.env.PRICE_JOB_RETRY_BASE_DELAY_MS, 5_000);
export const PRICE_JOB_RETRY_MAX_DELAY_MS = resolveIntegerEnv(process.env.PRICE_JOB_RETRY_MAX_DELAY_MS, 60_000);
export const PRICE_JOB_KEY_BUCKET_MS = resolveIntegerEnv(process.env.PRICE_JOB_KEY_BUCKET_MS, 60_000);
export const PRICE_UPDATE_COALESCE_WINDOW_MS = resolveIntegerEnv(process.env.PRICE_UPDATE_COALESCE_WINDOW_MS, 2_000);
export const PRICE_REFRESH_HIGH_MIN_SECONDS = resolveIntegerEnv(process.env.PRICE_REFRESH_HIGH_MIN_SECONDS, 60);
export const PRICE_REFRESH_HIGH_MAX_SECONDS = resolveIntegerEnv(process.env.PRICE_REFRESH_HIGH_MAX_SECONDS, 120);
export const PRICE_REFRESH_MEDIUM_MIN_SECONDS = resolveIntegerEnv(process.env.PRICE_REFRESH_MEDIUM_MIN_SECONDS, 600);
export const PRICE_REFRESH_MEDIUM_MAX_SECONDS = resolveIntegerEnv(process.env.PRICE_REFRESH_MEDIUM_MAX_SECONDS, 1_200);
export const PRICE_REFRESH_LOW_MIN_SECONDS = resolveIntegerEnv(process.env.PRICE_REFRESH_LOW_MIN_SECONDS, 3_600);
export const PRICE_REFRESH_LOW_MAX_SECONDS = resolveIntegerEnv(process.env.PRICE_REFRESH_LOW_MAX_SECONDS, 14_400);
export const PRICE_REFRESH_ILLIQUID_MIN_SECONDS = resolveIntegerEnv(process.env.PRICE_REFRESH_ILLIQUID_MIN_SECONDS, 43_200);
export const PRICE_REFRESH_ILLIQUID_MAX_SECONDS = resolveIntegerEnv(process.env.PRICE_REFRESH_ILLIQUID_MAX_SECONDS, 86_400);
export const AUCTION_CLOSER_INTERVAL_MS = 5 * 1000;
export const DROP_SCHEDULER_INTERVAL_MS = 10 * 1000;
export const MARKETPLACE_EVENTS_CHANNEL = "marketplace_events";
export const AUCTION_EVENTS_CHANNEL = "auction_events";
export const BALANCE_EVENTS_CHANNEL = "balance_events";
export const PRICE_UPDATES_CHANNEL = "price_updates";
export const PRICE_UPDATES_LEGACY_CHANNEL = "price_events";
export const AUCTIONS_LIST_COALESCING_ENABLED = resolveBooleanEnv(process.env.AUCTIONS_LIST_COALESCING_ENABLED, false);
export const AUCTIONS_LIST_COALESCE_WINDOW_MS = resolveIntegerEnv(process.env.AUCTIONS_LIST_COALESCE_WINDOW_MS, 300);
export const AUCTIONS_LIST_COALESCE_MAX_BUFFER = resolveIntegerEnv(process.env.AUCTIONS_LIST_COALESCE_MAX_BUFFER, 500);

export const RATE_LIMITS = {
  packPurchase: { limit: 5, windowSeconds: 10 },
  placeBid: { limit: 10, windowSeconds: 10 },
  buyListing: { limit: 5, windowSeconds: 10 },
  register: { limit: 5, windowSeconds: 5 * 60 },
  login: { limit: 5, windowSeconds: 5 * 60 }
} as const;

export const ECONOMICS_DEFAULT_WINDOW_HOURS = resolveIntegerEnv(process.env.ECONOMICS_DEFAULT_WINDOW_HOURS, 24);
export const ECONOMICS_MAX_WINDOW_DAYS = resolveIntegerEnv(process.env.ECONOMICS_MAX_WINDOW_DAYS, 31);

export const RARITY_ANCHOR_FALLBACK_CENTS: Record<RarityTier, number> = {
  common: 5,
  uncommon: 25,
  rare: 100,
  holo_rare: 300,
  ultra_rare: 1_200,
  chase: 5_000
};

export const TARGET_HOUSE_EDGE_BPS: Record<PackTier, number> = {
  standard: 2_700,
  premium: 1_785,
  elite: 1_558
};

export const ECONOMICS_INCIDENT_HOUSE_EDGE_DELTA_BPS = resolveIntegerEnv(
  process.env.ECONOMICS_INCIDENT_HOUSE_EDGE_DELTA_BPS,
  1_000
);
