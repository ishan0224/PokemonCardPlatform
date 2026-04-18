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
export type LiquidityTier = "high" | "medium" | "low" | "illiquid";

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

export type RevenueStreamKey = "pack_margin" | "trade_fee" | "auction_fee" | "platform_discount" | "manual_adjustment";

export interface EconomicsWindow {
  fromIso: string;
  toIso: string;
  durationHours: number;
}

export interface RevenueStreamBreakdown {
  stream: RevenueStreamKey;
  totalCents: MoneyCents;
  rowCount: number;
}

export interface HourlyRevenueBucket {
  hourIso: string;
  packMarginCents: MoneyCents;
  tradeFeeCents: MoneyCents;
  auctionFeeCents: MoneyCents;
  netCents: MoneyCents;
}

export interface PackTierCount {
  tier: PackTier;
  count: number;
}

export interface EconomicsSummary {
  window: EconomicsWindow;
  generatedAtIso: string;
  gmvCents: MoneyCents;
  gmvPackCents: MoneyCents;
  gmvTradeCents: MoneyCents;
  gmvAuctionCents: MoneyCents;
  netRevenueCents: MoneyCents;
  takeRateBps: number;
  revenueByStream: RevenueStreamBreakdown[];
  hourlySeries: HourlyRevenueBucket[];
  uniqueUsers: number;
  packsPurchased: number;
  packsPurchasedByTier: PackTierCount[];
  tradesExecuted: number;
  auctionsSettled: number;
  auctionAverageWinningBidCents: MoneyCents;
  auctionMaxWinningBidCents: MoneyCents;
  platformRevenueRowCount: number;
  transactionRowCount: number;
}

export interface PackTierEconomics {
  tier: PackTier;
  displayName: string;
  priceCents: MoneyCents;
  packsPurchased: number;
  theoreticalEvCents: MoneyCents;
  actualEvCents: MoneyCents | null;
  theoreticalHouseEdgeBps: number;
  actualHouseEdgeBps: number | null;
  deltaHouseEdgeBps: number | null;
  sigmaMarginCents: MoneyCents;
  bestMarginCents: MoneyCents | null;
  worstMarginCents: MoneyCents | null;
  targetHouseEdgeBps: number;
  anchorSource: "live" | "config" | "mixed";
}

export interface WorstPack {
  packId: string;
  tier: PackTier;
  pricePaidCents: MoneyCents;
  marginCents: MoneyCents;
  realizedEvCents: MoneyCents;
  buyerIdPrefix: string;
  purchasedAtIso: string;
  shareOfTotalBleedBps: number | null;
}

export interface TopAuction {
  auctionId: string;
  winningBidCents: MoneyCents;
  feeCapturedCents: MoneyCents;
  settledAtIso: string;
  winnerIdPrefix: string | null;
  hostUsername: string;
  cardName: string;
  cardImageUrl: string | null;
}

export interface IntegrityCheckResult {
  key: "fee_math" | "double_entry" | "trade_symmetry" | "tiers_losing_money";
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface IntegrityChecks {
  checks: IntegrityCheckResult[];
  tiersLosingMoneyCount: number;
}

export interface PackEconomicsBundle {
  window: EconomicsWindow;
  generatedAtIso: string;
  tiers: PackTierEconomics[];
  portfolio: {
    packsPurchased: number;
    sigmaMarginCents: MoneyCents;
    actualHouseEdgeBps: number | null;
    theoreticalHouseEdgeBps: number;
  };
  worstPacks: WorstPack[];
  topAuctions: TopAuction[];
  integrity: IntegrityChecks;
}
