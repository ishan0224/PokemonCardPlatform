import type { PackTier } from "../../lib/types";

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
export const AUCTION_CLOSER_INTERVAL_MS = 5 * 1000;
export const DROP_SCHEDULER_INTERVAL_MS = 10 * 1000;
export const MARKETPLACE_EVENTS_CHANNEL = "marketplace_events";

export const RATE_LIMITS = {
  packPurchase: { limit: 5, windowSeconds: 10 },
  placeBid: { limit: 10, windowSeconds: 10 },
  buyListing: { limit: 5, windowSeconds: 10 },
  register: { limit: 5, windowSeconds: 5 * 60 },
  login: { limit: 5, windowSeconds: 5 * 60 }
} as const;
