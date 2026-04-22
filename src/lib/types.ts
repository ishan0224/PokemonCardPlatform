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
export type CollectionCardTransactionType =
  | "pack_purchase"
  | "trade_buy"
  | "trade_sell"
  | "auction_win"
  | "auction_sell"
  | "auction_fee"
  | "trade_fee";

export interface CollectionCardTransaction {
  id: string;
  type: CollectionCardTransactionType;
  amount: number;
  createdAtIso: string;
}

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
export type RevenueProjectionStreamKey = "pack_margin" | "trade_fee" | "auction_fee";
export type RevenueProjectionMethod = "linear_extrapolation";

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
  revenueProjection: RevenueProjection;
  marginAlertCount24h: number;
  recentMarginAlerts: MarginAlertSnapshot[];
}

export interface RevenueProjectionStream {
  historicalDaily: MoneyCents;
  projectedHorizon: MoneyCents;
  method: RevenueProjectionMethod;
}

export interface RevenueProjection {
  windowDays: number;
  horizonDays: number;
  perStream: Record<RevenueProjectionStreamKey, RevenueProjectionStream>;
  totalProjectedHorizon: MoneyCents;
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

export interface AuctionPriceVsMarketMetrics {
  window: EconomicsWindow;
  sampleSize: number;
  medianRatio: number;
  meanRatio: number;
  p10: number;
  p50: number;
  p90: number;
  lowRatioCount: number;
  highRatioCount: number;
}

export interface MarginAlertSnapshot {
  tier: PackTier;
  direction: "below_band" | "above_band";
  deltaBps: number;
  ranAtIso: string;
}

export type FairnessAuditRunSource = "nightly" | "on_demand";

export interface FairnessAuditResult {
  id: UUID;
  windowStartIso: string;
  windowEndIso: string;
  observedCounts: Record<RarityTier, number>;
  expectedCounts: Record<RarityTier, number>;
  testStatistic: number;
  degreesOfFreedom: number;
  pValue: number;
  runSource: FairnessAuditRunSource;
  ranAtIso: string;
  sampleSize: number;
  monteCarloApplied: boolean;
  monteCarloSamples: number | null;
  monteCarloExtremeCount: number | null;
}

export interface UserHealthMetrics {
  dropEngagement: {
    purchasesPerUserAvg: number;
    selloutTimeAvgSeconds: number | null;
    dropfillDistribution: {
      lt25: number;
      gte25Lt50: number;
      gte50Lt75: number;
      gte75: number;
    };
  };
  auctionParticipation: {
    bidsPerAuctionAvg: number;
    uniqueBiddersPerAuctionAvg: number;
    watcherCountAvg: number | null;
    watcherCountMetricSource: "auction_watcher_samples" | "not_collected";
  };
  retention: {
    cohortBuyerCount: number;
    d1ReturningBuyerCount: number;
    d7ReturningBuyerCount: number;
    d1Rate: number;
    d7Rate: number;
  };
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
  auctionPriceVsMarket: AuctionPriceVsMarketMetrics;
  incidentDeltaBps: number;
  rateLimitHitCount24h: number;
  rateLimitHitGlobalCount24h: number;
  autoRebalanceTriggeredCount24h: number;
  finalWindowBidCount24h: number;
  openAuctionFlagCount: number;
  marginIncidentCount24h: number;
  marginAlertCount24h: number;
  recentMarginAlerts: MarginAlertSnapshot[];
  verificationUsageDistinctUsers7d: number;
  userHealth: UserHealthMetrics;
}

export interface AdminMetricsDeltaEvent {
  rateLimitHitCountDelta: number;
  rateLimitHitGlobalCountDelta: number;
  autoRebalanceTriggeredCountDelta: number;
  finalWindowBidCountDelta: number;
  openAuctionFlagCountDelta: number;
  marginIncidentCountDelta: number;
  persisted?: boolean;
  emittedAtIso: string;
}

export type AuctionFlagResolution = "dismissed" | "actioned";

export interface AuctionFlagReviewItem {
  id: UUID;
  auctionId: UUID;
  flagType: string;
  evidence: Record<string, unknown>;
  createdAtIso: string;
  resolvedAtIso: string | null;
  resolvedBy: UUID | null;
  resolution: AuctionFlagResolution | null;
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
