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

export const PACK_TIERS: readonly PackTier[] = ["standard", "premium", "elite"];
export const RARITY_TIERS: readonly RarityTier[] = ["common", "uncommon", "rare", "holo_rare", "ultra_rare", "chase"];
export type LiquidityTier = "high" | "medium" | "low" | "illiquid";

export type DropStatus = "upcoming" | "active" | "completed" | "cancelled";
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
  anchorFallbackRarities?: RarityTier[];
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

export interface BidsInFinal10PctMetric {
  auctionCount: number;
  totalBids: number;
  finalWindowBids: number;
  rate: number;
}

export interface AuctionSnipeMetrics {
  extensionTriggerRate: number;
  bidsInFinal10Pct: BidsInFinal10PctMetric;
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
  auctionSnipeMetrics: AuctionSnipeMetrics;
}

export interface EconomicsSimulationTier {
  tier: PackTier;
  weights: SlotDistribution[][];
  meanEV: number;
  stdDev: number;
  winRate: number;
  p10: number;
  p50: number;
  p90: number;
  projectedMarginOver1000Packs: number;
  targetEdge: number;
  achievedEdge: number;
  targetEdgeBps: number;
  achievedEdgeBps: number;
  edgeDeltaBps: number;
  aggressiveEdgeWarning: boolean;
  constraintsSatisfied: boolean;
  failure: {
    tier: PackTier;
    stage: "feasibility" | "optimization";
    code: string;
    message: string;
    violatedConstraints: string[];
    nearestFeasibleGap: {
      edgeGap: number;
      winRateGap: number;
      feasibilityDistance: number;
    };
    details?: Record<string, unknown>;
  } | null;
}

export interface EconomicsSimulation {
  tiers: EconomicsSimulationTier[];
  generatedAtIso: string;
  sourceGenerationVersionId: string;
  anchorSource: "live_current_price_eligible_catalog";
  anchorSnapshotMeta: {
    source: "live_current_price_eligible_catalog";
    fallbackApplied: false;
    byRarity: Record<
      RarityTier,
      {
        eligibleCardCount: number;
        pricedCardCount: number;
        missingPriceCount: number;
        meanPriceCents: number | null;
        minPriceCents: number | null;
        maxPriceCents: number | null;
      }
    >;
  };
}

export interface EconomicsGenerationVersion {
  id: UUID;
  versionNumber: number;
  algorithmVersion: string;
  contentHash: string;
  createdAt: string;
}

export interface EconomicsGenerationVersionPage {
  versions: EconomicsGenerationVersion[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface EconomicsRebalanceResult {
  action: "no_op" | "inserted";
  version: {
    id: UUID;
    versionNumber: number;
    algorithmVersion: string;
    contentHash: string;
  };
  tierFailures: Array<{
    tier: PackTier;
    stage: "feasibility" | "optimization";
    code: string;
    message: string;
    violatedConstraints: string[];
    nearestFeasibleGap: {
      edgeGap: number;
      winRateGap: number;
      feasibilityDistance: number;
    };
    details?: Record<string, unknown>;
  }>;
  anchorSource: "live_current_price_eligible_catalog";
  anchorSnapshotMeta: {
    source: "live_current_price_eligible_catalog";
    fallbackApplied: false;
    byRarity: Record<
      RarityTier,
      {
        eligibleCardCount: number;
        pricedCardCount: number;
        missingPriceCount: number;
        meanPriceCents: number | null;
        minPriceCents: number | null;
        maxPriceCents: number | null;
      }
    >;
  };
  diagnosticsByTier?: Record<
    PackTier,
    {
      achievedEdge: number;
      targetEdge: number;
      achievedEdgeBps: number;
      targetEdgeBps: number;
      edgeDeltaBps: number;
      aggressiveEdgeWarning: boolean;
      winRateFloor: number;
      distribution: {
        meanEV: number;
        stdDev: number;
        p10: number;
        p50: number;
        p90: number;
        winRate: number;
        projectedMarginOver1000Packs: number;
      };
      violatedConstraints: string[];
      nearestFeasibleGap: {
        edgeGap: number;
        winRateGap: number;
        feasibilityDistance: number;
      };
    }
  >;
}
