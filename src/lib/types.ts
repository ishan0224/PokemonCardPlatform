export type UUID = string;
export type MoneyCents = number;

export type PackTier = "standard" | "premium" | "elite";
export type RarityTier =
  | "common"
  | "uncommon"
  | "rare"
  | "holo_rare"
  | "ultra_rare"
  | "chase";

export type DropStatus = "upcoming" | "active" | "completed";
export type CardState = "in_pack" | "owned" | "listed" | "in_auction";
export type ListingStatus = "active" | "sold" | "cancelled";
export type AuctionStatus = "active" | "completed" | "cancelled";
export type AuctionDurationType = "1h" | "6h" | "24h";
export type HoldStatus = "active" | "released" | "captured";

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ErrorResponse {
  error: ApiError;
}

export interface SlotDistribution {
  rarity: RarityTier;
  weight: number;
}

export interface PackTierConfig {
  tier: PackTier;
  displayName: string;
  priceCents: MoneyCents;
  cardsPerPack: number;
  slots: SlotDistribution[][];
}
