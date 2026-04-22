import { createHash } from "crypto";
import type { QueryResult, QueryResultRow } from "pg";
import type { PackTier, RarityTier, SlotDistribution } from "../../lib/types";
import { PACK_TIERS, RARITY_TIERS } from "../../lib/types";
import { ECONOMICS_EDGE_OVERSHOOT_WARN_BPS, TARGET_HOUSE_EDGE_BPS } from "../config/constants";
import { PACK_TIER_CONFIGS } from "../config/pack-tiers";
import { withTransaction } from "../db/pool";
import {
  buildAnchorSnapshotFromCatalog,
  getLatestGenerationVersion,
  type GenerationAnchorSnapshot,
  type GenerationEligibleIdsByTier,
  type GenerationVersion,
  type GenerationWeightsByTier
} from "../services/pack-generation-version.service";
import {
  solveWeights,
  type SolverBounds,
  type SolverTierDiagnostics,
  type SolverTierFailure,
  type WeightSolverOutput
} from "./weight-solver";

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
};

type CardPriceRow = {
  id: string;
  rarity_tier: RarityTier;
  current_price: string;
};

type VersionListRow = {
  id: string;
  version_number: string;
  algorithm_version: string;
  content_hash: string;
  created_at: string;
};

type CountRow = {
  count: string;
};

export type EconomicsAnchorSource = "live_current_price_eligible_catalog";

export type EconomicsAnchorSnapshotMeta = {
  source: EconomicsAnchorSource;
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

export type EconomicsSimulateKnobs = {
  anchorScale?: number;
  ultraRareMaxWeight?: number;
  chaseMaxWeight?: number;
  targetEdgeByTier?: Partial<Record<PackTier, number>>;
  winRateFloorByTier?: Partial<Record<PackTier, number>>;
};

export type EconomicsSimulateTierResult = {
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
  failure: SolverTierFailure | null;
};

export type EconomicsSimulateResult = {
  tiers: EconomicsSimulateTierResult[];
  generatedAtIso: string;
  sourceGenerationVersionId: string;
  anchorSource: EconomicsAnchorSource;
  anchorSnapshotMeta: EconomicsAnchorSnapshotMeta;
};

export type EconomicsRebalanceResult = {
  action: "no_op" | "inserted";
  version: {
    id: string;
    versionNumber: number;
    algorithmVersion: string;
    contentHash: string;
  };
  tierFailures: SolverTierFailure[];
  diagnosticsByTier: Record<
    PackTier,
    SolverTierDiagnostics & {
      targetEdgeBps: number;
      achievedEdgeBps: number;
      edgeDeltaBps: number;
      aggressiveEdgeWarning: boolean;
    }
  >;
  anchorSource: EconomicsAnchorSource;
  anchorSnapshotMeta: EconomicsAnchorSnapshotMeta;
};

export type EconomicsRebalanceLockMode = "wait" | "try";

export type EconomicsGenerationVersionListItem = {
  id: string;
  versionNumber: number;
  algorithmVersion: string;
  contentHash: string;
  createdAt: string;
};

export type EconomicsGenerationVersionListResult = {
  versions: EconomicsGenerationVersionListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export class EconomicsRebalanceError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, statusCode = 400, code = "ECONOMICS_REBALANCE_ERROR", details?: Record<string, unknown>) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

const REBALANCE_ADVISORY_LOCK_ID = 42;

const BASE_SOLVER_BOUNDS: SolverBounds = {
  globalWeightMin: 0,
  globalWeightMax: 1,
  rarityFloorByTier: {
    common: 0.02,
    uncommon: 0.01
  },
  rarityCapByTier: {
    ultra_rare: 0.35,
    chase: 0.2
  },
  featureOutlierPriceMultiplier: 1.5,
  monteCarloSamples: 10_000,
  optimizationStep: 0.005,
  optimizationMaxIterations: 20_000
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

export function computeEconomicsContentHash(input: {
  algorithmVersion: string;
  weightsByTier: GenerationWeightsByTier;
  eligibleCardIdsByTier: GenerationEligibleIdsByTier;
  anchorSnapshot: GenerationAnchorSnapshot;
}): string {
  const canonical = stableStringify({
    algorithmVersion: input.algorithmVersion,
    weightsByTier: input.weightsByTier,
    eligibleCardIdsByTier: input.eligibleCardIdsByTier,
    anchorSnapshot: input.anchorSnapshot
  });

  return createHash("sha256").update(canonical).digest("hex");
}

function normalizeKnobs(knobs?: EconomicsSimulateKnobs): Required<EconomicsSimulateKnobs> {
  const anchorScaleRaw = knobs?.anchorScale ?? 1;
  const ultraRareMaxWeightRaw = knobs?.ultraRareMaxWeight ?? BASE_SOLVER_BOUNDS.rarityCapByTier.ultra_rare ?? 0.35;
  const chaseMaxWeightRaw = knobs?.chaseMaxWeight ?? BASE_SOLVER_BOUNDS.rarityCapByTier.chase ?? 0.2;

  return {
    anchorScale: Number.isFinite(anchorScaleRaw) ? Math.min(5, Math.max(0.01, anchorScaleRaw)) : 1,
    ultraRareMaxWeight: Number.isFinite(ultraRareMaxWeightRaw)
      ? Math.min(1, Math.max(0, ultraRareMaxWeightRaw))
      : BASE_SOLVER_BOUNDS.rarityCapByTier.ultra_rare ?? 0.35,
    chaseMaxWeight: Number.isFinite(chaseMaxWeightRaw)
      ? Math.min(1, Math.max(0, chaseMaxWeightRaw))
      : BASE_SOLVER_BOUNDS.rarityCapByTier.chase ?? 0.2,
    targetEdgeByTier: knobs?.targetEdgeByTier ?? {},
    winRateFloorByTier: knobs?.winRateFloorByTier ?? {}
  };
}

function toEdgeBps(ratio: number): number {
  return Math.round(ratio * 10_000);
}

function buildEdgeDistanceDiagnostics(input: {
  targetEdge: number;
  achievedEdge: number;
  constraintsSatisfied: boolean;
}): {
  targetEdgeBps: number;
  achievedEdgeBps: number;
  edgeDeltaBps: number;
  aggressiveEdgeWarning: boolean;
} {
  const targetEdgeBps = toEdgeBps(input.targetEdge);
  const achievedEdgeBps = toEdgeBps(input.achievedEdge);
  const edgeDeltaBps = achievedEdgeBps - targetEdgeBps;

  return {
    targetEdgeBps,
    achievedEdgeBps,
    edgeDeltaBps,
    aggressiveEdgeWarning: input.constraintsSatisfied && edgeDeltaBps > ECONOMICS_EDGE_OVERSHOOT_WARN_BPS
  };
}

function normalizePagination(input: { page?: number; limit?: number }): { page: number; limit: number; offset: number } {
  const page = Number.isFinite(input.page) ? Math.max(1, Math.trunc(input.page as number)) : 1;
  const limit = Number.isFinite(input.limit) ? Math.min(100, Math.max(1, Math.trunc(input.limit as number))) : 20;
  return {
    page,
    limit,
    offset: (page - 1) * limit
  };
}

async function loadLatestGenerationVersionOrThrow(client: Queryable): Promise<GenerationVersion> {
  const latest = await getLatestGenerationVersion(client);
  if (!latest) {
    throw new EconomicsRebalanceError(
      "No generation version found. Run Phase 0 bootstrap before economics rebalance.",
      409,
      "GENERATION_VERSION_MISSING"
    );
  }

  return latest;
}

async function loadPriceMapForEligibleIds(
  client: Queryable,
  eligibleByTier: GenerationEligibleIdsByTier
): Promise<Map<string, { rarityTier: RarityTier; currentPrice: number }>> {
  const allIds = new Set<string>();
  for (const tier of PACK_TIERS) {
    const tierPools = eligibleByTier[tier];
    for (const rarity of Object.keys(tierPools) as RarityTier[]) {
      for (const cardId of tierPools[rarity]) {
        allIds.add(cardId);
      }
    }
  }

  const ids = Array.from(allIds);
  if (ids.length === 0) {
    return new Map();
  }

  const rows = await client.query<CardPriceRow>(
    `SELECT id, rarity_tier, current_price
     FROM pokemon_cards
     WHERE id = ANY($1::uuid[])`,
    [ids]
  );

  const priceMap = new Map<string, { rarityTier: RarityTier; currentPrice: number }>();
  for (const row of rows.rows) {
    priceMap.set(row.id, {
      rarityTier: row.rarity_tier,
      currentPrice: Number(row.current_price)
    });
  }

  return priceMap;
}

function buildRarityPricePoolsForTier(input: {
  tier: PackTier;
  eligibleByTier: GenerationEligibleIdsByTier;
  priceMap: Map<string, { rarityTier: RarityTier; currentPrice: number }>;
  anchorScale: number;
}): Record<RarityTier, number[]> {
  const tierEligible = input.eligibleByTier[input.tier];
  const pools: Record<RarityTier, number[]> = {
    common: [],
    uncommon: [],
    rare: [],
    holo_rare: [],
    ultra_rare: [],
    chase: []
  };

  for (const rarity of Object.keys(tierEligible) as RarityTier[]) {
    const ids = tierEligible[rarity];

    for (const id of ids) {
      const card = input.priceMap.get(id);
      if (!card) {
        continue;
      }

      pools[rarity].push(card.currentPrice * input.anchorScale);
    }
  }

  return pools;
}

function buildSolverBounds(knobs: Required<EconomicsSimulateKnobs>): SolverBounds {
  return {
    ...BASE_SOLVER_BOUNDS,
    rarityCapByTier: {
      ...BASE_SOLVER_BOUNDS.rarityCapByTier,
      ultra_rare: knobs.ultraRareMaxWeight,
      chase: knobs.chaseMaxWeight
    }
  };
}

function buildSolverInput(input: {
  latest: GenerationVersion;
  priceMap: Map<string, { rarityTier: RarityTier; currentPrice: number }>;
  knobs: Required<EconomicsSimulateKnobs>;
}): Parameters<typeof solveWeights>[0] {
  const bounds = buildSolverBounds(input.knobs);

  const tiers = {} as Parameters<typeof solveWeights>[0]["tiers"];
  for (const tier of PACK_TIERS) {
    const tierWeights = input.latest.payload.weightsByTier[tier];
    tiers[tier] = {
      tier,
      packPriceCents: PACK_TIER_CONFIGS[tier].priceCents,
      slots: tierWeights.slots,
      rarityPricePools: buildRarityPricePoolsForTier({
        tier,
        eligibleByTier: input.latest.payload.eligibleCardIdsByTier,
        priceMap: input.priceMap,
        anchorScale: input.knobs.anchorScale
      }),
      targetEdge: input.knobs.targetEdgeByTier[tier] ?? TARGET_HOUSE_EDGE_BPS[tier] / 10_000,
      winRateFloor: input.knobs.winRateFloorByTier[tier] ?? 0,
      featureSlotIndexes: [tierWeights.slots.length - 1]
    };
  }

  return {
    tiers,
    bounds
  };
}

function buildAnchorSnapshotMeta(input: {
  eligibleByTier: GenerationEligibleIdsByTier;
  priceMap: Map<string, { rarityTier: RarityTier; currentPrice: number }>;
}): EconomicsAnchorSnapshotMeta {
  const idsByRarity = {} as Record<RarityTier, Set<string>>;
  for (const rarity of RARITY_TIERS) {
    idsByRarity[rarity] = new Set<string>();
  }

  for (const tier of PACK_TIERS) {
    const tierPools = input.eligibleByTier[tier];
    for (const rarity of Object.keys(tierPools) as RarityTier[]) {
      for (const cardId of tierPools[rarity]) {
        idsByRarity[rarity].add(cardId);
      }
    }
  }

  const byRarity = {} as EconomicsAnchorSnapshotMeta["byRarity"];
  for (const rarity of Object.keys(idsByRarity) as RarityTier[]) {
    const eligibleIds = [...idsByRarity[rarity]];
    const prices: number[] = [];
    for (const cardId of eligibleIds) {
      const row = input.priceMap.get(cardId);
      if (row) {
        prices.push(row.currentPrice);
      }
    }

    const eligibleCardCount = eligibleIds.length;
    const pricedCardCount = prices.length;
    const missingPriceCount = Math.max(0, eligibleCardCount - pricedCardCount);
    const meanPriceCents =
      pricedCardCount > 0 ? Math.round(prices.reduce((sum, value) => sum + value, 0) / pricedCardCount) : null;

    byRarity[rarity] = {
      eligibleCardCount,
      pricedCardCount,
      missingPriceCount,
      meanPriceCents,
      minPriceCents: pricedCardCount > 0 ? Math.min(...prices) : null,
      maxPriceCents: pricedCardCount > 0 ? Math.max(...prices) : null
    };
  }

  return {
    source: "live_current_price_eligible_catalog",
    fallbackApplied: false,
    byRarity
  };
}

function toSimulateTierResult(output: WeightSolverOutput): EconomicsSimulateTierResult[] {
  return PACK_TIERS.map((tier) => {
    const result = output.resultsByTier[tier];
    const edgeDistance = buildEdgeDistanceDiagnostics({
      targetEdge: result.diagnostics.targetEdge,
      achievedEdge: result.diagnostics.achievedEdge,
      constraintsSatisfied: result.diagnostics.constraintsSatisfied
    });

    return {
      tier,
      weights: result.solvedSlots,
      meanEV: result.diagnostics.distribution.meanEV,
      stdDev: result.diagnostics.distribution.stdDev,
      winRate: result.diagnostics.distribution.winRate,
      p10: result.diagnostics.distribution.p10,
      p50: result.diagnostics.distribution.p50,
      p90: result.diagnostics.distribution.p90,
      projectedMarginOver1000Packs: result.diagnostics.distribution.projectedMarginOver1000Packs,
      targetEdge: result.diagnostics.targetEdge,
      achievedEdge: result.diagnostics.achievedEdge,
      targetEdgeBps: edgeDistance.targetEdgeBps,
      achievedEdgeBps: edgeDistance.achievedEdgeBps,
      edgeDeltaBps: edgeDistance.edgeDeltaBps,
      aggressiveEdgeWarning: edgeDistance.aggressiveEdgeWarning,
      constraintsSatisfied: result.diagnostics.constraintsSatisfied,
      failure: result.failure
    };
  });
}

function mapDiagnosticsByTier(
  solverOutput: WeightSolverOutput
): EconomicsRebalanceResult["diagnosticsByTier"] {
  return {
    standard: {
      ...solverOutput.resultsByTier.standard.diagnostics,
      ...buildEdgeDistanceDiagnostics({
        targetEdge: solverOutput.resultsByTier.standard.diagnostics.targetEdge,
        achievedEdge: solverOutput.resultsByTier.standard.diagnostics.achievedEdge,
        constraintsSatisfied: solverOutput.resultsByTier.standard.diagnostics.constraintsSatisfied
      })
    },
    premium: {
      ...solverOutput.resultsByTier.premium.diagnostics,
      ...buildEdgeDistanceDiagnostics({
        targetEdge: solverOutput.resultsByTier.premium.diagnostics.targetEdge,
        achievedEdge: solverOutput.resultsByTier.premium.diagnostics.achievedEdge,
        constraintsSatisfied: solverOutput.resultsByTier.premium.diagnostics.constraintsSatisfied
      })
    },
    elite: {
      ...solverOutput.resultsByTier.elite.diagnostics,
      ...buildEdgeDistanceDiagnostics({
        targetEdge: solverOutput.resultsByTier.elite.diagnostics.targetEdge,
        achievedEdge: solverOutput.resultsByTier.elite.diagnostics.achievedEdge,
        constraintsSatisfied: solverOutput.resultsByTier.elite.diagnostics.constraintsSatisfied
      })
    }
  };
}

function mergeWeightsWithFailures(input: {
  latestWeightsByTier: GenerationWeightsByTier;
  solverOutput: WeightSolverOutput;
}): GenerationWeightsByTier {
  const merged = {} as GenerationWeightsByTier;

  for (const tier of PACK_TIERS) {
    const latestTier = input.latestWeightsByTier[tier];
    const solverTier = input.solverOutput.resultsByTier[tier];

    merged[tier] = {
      cardsPerPack: latestTier.cardsPerPack,
      slots: solverTier.failure ? latestTier.slots : solverTier.solvedSlots
    };
  }

  return merged;
}

async function writeTierFailuresToSecurityEvents(
  client: Queryable,
  actorUserId: string | null,
  sourceGenerationVersionId: string,
  failures: SolverTierFailure[]
): Promise<void> {
  for (const failure of failures) {
    await client.query(
      `INSERT INTO security_events (event_type, user_id, evidence_json)
       VALUES ('econ_rebalance_infeasible', $1, $2::jsonb)`,
      [
        actorUserId,
        JSON.stringify({
          tier: failure.tier,
          code: failure.code,
          message: failure.message,
          details: failure.details,
          sourceGenerationVersionId
        })
      ]
    );
  }
}

export async function simulateEconomicsRebalance(knobs?: EconomicsSimulateKnobs): Promise<EconomicsSimulateResult> {
  const normalizedKnobs = normalizeKnobs(knobs);

  return withTransaction(async (client) => {
    const latest = await loadLatestGenerationVersionOrThrow(client);
    const priceMap = await loadPriceMapForEligibleIds(client, latest.payload.eligibleCardIdsByTier);
    const anchorSnapshotMeta = buildAnchorSnapshotMeta({
      eligibleByTier: latest.payload.eligibleCardIdsByTier,
      priceMap
    });
    const solverInput = buildSolverInput({ latest, priceMap, knobs: normalizedKnobs });
    const solverOutput = solveWeights(solverInput);

    return {
      tiers: toSimulateTierResult(solverOutput),
      generatedAtIso: new Date().toISOString(),
      sourceGenerationVersionId: latest.id,
      anchorSource: "live_current_price_eligible_catalog",
      anchorSnapshotMeta
    };
  });
}

export async function rebalanceEconomics(input: {
  actorUserId?: string | null;
  knobs?: EconomicsSimulateKnobs;
  lockMode?: EconomicsRebalanceLockMode;
}): Promise<EconomicsRebalanceResult> {
  const normalizedKnobs = normalizeKnobs(input.knobs);
  const lockMode = input.lockMode ?? "wait";

  return withTransaction(async (client) => {
    if (lockMode === "try") {
      const lockResult = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_xact_lock($1) AS acquired",
        [REBALANCE_ADVISORY_LOCK_ID]
      );
      if (!lockResult.rows[0]?.acquired) {
        throw new EconomicsRebalanceError(
          "Economics rebalance lock is contended.",
          409,
          "REBALANCE_LOCK_CONTENDED"
        );
      }
    } else {
      await client.query("SELECT pg_advisory_xact_lock($1)", [REBALANCE_ADVISORY_LOCK_ID]);
    }

    const latest = await loadLatestGenerationVersionOrThrow(client);
    const priceMap = await loadPriceMapForEligibleIds(client, latest.payload.eligibleCardIdsByTier);
    const anchorSnapshotMeta = buildAnchorSnapshotMeta({
      eligibleByTier: latest.payload.eligibleCardIdsByTier,
      priceMap
    });
    const solverInput = buildSolverInput({ latest, priceMap, knobs: normalizedKnobs });
    const solverOutput = solveWeights(solverInput);

    const tierFailures = PACK_TIERS.map((tier) => solverOutput.resultsByTier[tier].failure).filter(
      (failure): failure is SolverTierFailure => failure !== null
    );

    if (tierFailures.length > 0) {
      await writeTierFailuresToSecurityEvents(client, input.actorUserId ?? null, latest.id, tierFailures);
    }

    const mergedWeightsByTier = mergeWeightsWithFailures({
      latestWeightsByTier: latest.payload.weightsByTier,
      solverOutput
    });

    const anchorSnapshot = await buildAnchorSnapshotFromCatalog(client);

    const nextContentHash = computeEconomicsContentHash({
      algorithmVersion: latest.algorithmVersion,
      weightsByTier: mergedWeightsByTier,
      eligibleCardIdsByTier: latest.payload.eligibleCardIdsByTier,
      anchorSnapshot
    });

    if (nextContentHash === latest.contentHash) {
      return {
        action: "no_op",
        version: {
          id: latest.id,
          versionNumber: latest.versionNumber,
          algorithmVersion: latest.algorithmVersion,
          contentHash: latest.contentHash
        },
        tierFailures,
        diagnosticsByTier: mapDiagnosticsByTier(solverOutput),
        anchorSource: "live_current_price_eligible_catalog",
        anchorSnapshotMeta
      };
    }

    const inserted = await client.query<{
      id: string;
      version_number: string;
      algorithm_version: string;
      content_hash: string;
    }>(
      `INSERT INTO pack_generation_versions (
         algorithm_version,
         weights_json,
         eligible_card_ids_json,
         anchor_snapshot_json,
         content_hash
       )
       VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5)
       ON CONFLICT (content_hash) DO NOTHING
       RETURNING id, version_number, algorithm_version, content_hash`,
      [
        latest.algorithmVersion,
        JSON.stringify(mergedWeightsByTier),
        JSON.stringify(latest.payload.eligibleCardIdsByTier),
        JSON.stringify(anchorSnapshot),
        nextContentHash
      ]
    );

    if (inserted.rowCount === 1) {
      const row = inserted.rows[0];
      return {
        action: "inserted",
        version: {
          id: row.id,
          versionNumber: Number(row.version_number),
          algorithmVersion: row.algorithm_version,
          contentHash: row.content_hash
        },
        tierFailures,
        diagnosticsByTier: mapDiagnosticsByTier(solverOutput),
        anchorSource: "live_current_price_eligible_catalog",
        anchorSnapshotMeta
      };
    }

    const existing = await client.query<{
      id: string;
      version_number: string;
      algorithm_version: string;
      content_hash: string;
    }>(
      `SELECT id, version_number, algorithm_version, content_hash
       FROM pack_generation_versions
       WHERE content_hash = $1
       LIMIT 1`,
      [nextContentHash]
    );

    if (existing.rowCount !== 1) {
      throw new EconomicsRebalanceError(
        "Failed to resolve generation version row after rebalance insert attempt.",
        500,
        "REBALANCE_INSERT_RESOLUTION_FAILED"
      );
    }

    const row = existing.rows[0];
    return {
      action: "no_op",
      version: {
        id: row.id,
        versionNumber: Number(row.version_number),
        algorithmVersion: row.algorithm_version,
        contentHash: row.content_hash
      },
      tierFailures,
      diagnosticsByTier: mapDiagnosticsByTier(solverOutput),
      anchorSource: "live_current_price_eligible_catalog",
      anchorSnapshotMeta
    };
  });
}

export async function listGenerationVersions(input: {
  page?: number;
  limit?: number;
}): Promise<EconomicsGenerationVersionListResult> {
  const pagination = normalizePagination(input);

  return withTransaction(async (client) => {
    const totalResult = await client.query<CountRow>("SELECT COUNT(*)::BIGINT AS count FROM pack_generation_versions");
    const total = Number(totalResult.rows[0]?.count ?? "0");

    const rows = await client.query<VersionListRow>(
      `SELECT id, version_number, algorithm_version, content_hash, created_at
       FROM pack_generation_versions
       ORDER BY version_number DESC
       LIMIT $1 OFFSET $2`,
      [pagination.limit, pagination.offset]
    );

    return {
      versions: rows.rows.map((row) => ({
        id: row.id,
        versionNumber: Number(row.version_number),
        algorithmVersion: row.algorithm_version,
        contentHash: row.content_hash,
        createdAt: row.created_at
      })),
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pagination.limit)
      }
    };
  });
}
