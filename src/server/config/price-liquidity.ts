import type { LiquidityTier, RarityTier } from "../../lib/types";

export type LiquidityRefreshWindowSeconds = {
  min: number;
  max: number;
};

export const DEFAULT_LIQUIDITY_TIER_BY_RARITY: Record<RarityTier, LiquidityTier> = {
  common: "illiquid",
  uncommon: "illiquid",
  rare: "low",
  holo_rare: "medium",
  ultra_rare: "medium",
  chase: "high"
};

export const LIQUIDITY_TIER_REFRESH_WINDOW_SECONDS: Record<LiquidityTier, LiquidityRefreshWindowSeconds> = {
  high: { min: 60, max: 120 },
  medium: { min: 10 * 60, max: 20 * 60 },
  low: { min: 60 * 60, max: 4 * 60 * 60 },
  illiquid: { min: 12 * 60 * 60, max: 24 * 60 * 60 }
};

const LIQUIDITY_TIER_RANK: Record<LiquidityTier, number> = {
  illiquid: 0,
  low: 1,
  medium: 2,
  high: 3
};

export function defaultLiquidityTierForRarity(rarityTier: RarityTier): LiquidityTier {
  return DEFAULT_LIQUIDITY_TIER_BY_RARITY[rarityTier];
}

export function chooseHigherLiquidityTier(current: LiquidityTier, candidate: LiquidityTier): LiquidityTier {
  return LIQUIDITY_TIER_RANK[candidate] > LIQUIDITY_TIER_RANK[current] ? candidate : current;
}

export function computeNextPriceRefreshAt(
  liquidityTier: LiquidityTier,
  now: Date = new Date(),
  randomSource: () => number = Math.random
): Date {
  const window = LIQUIDITY_TIER_REFRESH_WINDOW_SECONDS[liquidityTier];
  const min = Math.max(Math.trunc(window.min), 0);
  const max = Math.max(Math.trunc(window.max), min);
  const offsetSeconds = min + Math.floor(randomSource() * (max - min + 1));

  return new Date(now.getTime() + offsetSeconds * 1000);
}
