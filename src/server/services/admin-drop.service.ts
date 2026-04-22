import type { QueryResult, QueryResultRow } from "pg";
import type { DropStatus, PackTier, RarityTier, SlotDistribution } from "../../lib/types";
import { PACK_TIERS, RARITY_TIERS } from "../../lib/types";
import { PACK_TIER_CONFIGS } from "../config/pack-tiers";
import { withTransaction } from "../db/pool";
import {
  GENERATION_VERSION_ALGORITHM,
  buildAnchorSnapshotFromCatalog,
  ensureGenerationVersion,
  type GenerationEligibleIdsByTier,
  type GenerationWeightsByTier
} from "./pack-generation-version.service";

const DEFAULT_DROP_NAME = "Untitled Drop";
const DEFAULT_MAX_PACKS_PER_USER = 2;
const MAX_DROPS_PAGE_SIZE = 50;
const MAX_EXPLICIT_CARD_IDS_PER_TIER = 500;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
};

export type AdminDropStatus = DropStatus | "draft";

export type AdminDropTierCompositionInput = {
  setKeys: string[];
  includedRarities: RarityTier[];
  explicitIncludeCardIds: string[];
  explicitExcludeCardIds: string[];
};

export type AdminDropTierInput = {
  tier: PackTier;
  price: number;
  totalInventory: number;
  composition: AdminDropTierCompositionInput;
};

export type AdminDropMutationInput = {
  name: string;
  scheduledAt: string;
  lotteryEnabled: boolean;
  maxPacksPerUser: number;
  tiers: AdminDropTierInput[];
};

export type AdminDropTierPreview = {
  tier: PackTier;
  cardsPerPack: number;
  slots: SlotDistribution[][];
  eligibleCounts: Record<RarityTier, number>;
  requiredPerRarity: number;
  readiness: {
    ready: boolean;
    issues: Array<{
      rarity: RarityTier;
      required: number;
      actual: number;
    }>;
  };
};

export type AdminDropPreview = {
  tiers: AdminDropTierPreview[];
  overallReady: boolean;
};

export type AdminDropTierView = {
  tier: PackTier;
  price: number;
  totalInventory: number;
  remainingInventory: number;
  consumedInventory: number;
  cardsPerPack: number;
  slots: SlotDistribution[][];
  composition: AdminDropTierCompositionInput;
  eligibleCounts: Record<RarityTier, number>;
};

export type AdminDropLotteryStats = {
  wins: number;
  losses: number;
  unavailable: number;
};

export type AdminDropSchedulerStats = {
  issueCount: number;
  lastIssueAt: string | null;
};

export type AdminDropView = {
  id: string;
  name: string;
  status: AdminDropStatus;
  scheduledAt: string;
  lotteryEnabled: boolean;
  maxPacksPerUser: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  tiers: AdminDropTierView[];
  inventory: {
    total: number;
    remaining: number;
    consumed: number;
  };
  lottery: AdminDropLotteryStats;
  scheduler: AdminDropSchedulerStats;
};

export class AdminDropServiceError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, statusCode = 400, code = "ADMIN_DROP_ERROR", details?: Record<string, unknown>) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

type DropCursor = {
  createdAt: string;
  id: string;
};

type DropRow = {
  id: string;
  name: string;
  status: AdminDropStatus;
  scheduled_at: string;
  lottery_enabled: boolean;
  max_packs_per_user: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

type TierRow = {
  drop_id: string;
  tier: PackTier;
  price: string;
  total_inventory: number;
  remaining_inventory: number;
  set_keys_json: unknown;
  included_rarities_json: unknown;
  explicit_include_card_ids_json: unknown;
  explicit_exclude_card_ids_json: unknown;
  eligible_counts_json: unknown;
};

type LotteryStatsRow = {
  drop_id: string;
  wins: string;
  losses: string;
  unavailable: string;
};

type SchedulerStatsRow = {
  drop_id: string;
  issue_count: string;
  last_issue_at: string | null;
};

type EligibleCardRow = {
  id: string;
  rarity_tier: RarityTier;
};

type TierContext = {
  tier: PackTier;
  price: number;
  totalInventory: number;
  normalizedComposition: AdminDropTierCompositionInput;
  eligibleCardIdsByRarity: Record<RarityTier, string[]>;
  eligibleCounts: Record<RarityTier, number>;
  readinessIssues: Array<{
    rarity: RarityTier;
    required: number;
    actual: number;
  }>;
};

function defaultEligibleCounts(): Record<RarityTier, number> {
  return {
    common: 0,
    uncommon: 0,
    rare: 0,
    holo_rare: 0,
    ultra_rare: 0,
    chase: 0
  };
}

function encodeCursor(cursor: DropCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | null | undefined): DropCursor | null {
  if (!cursor || cursor.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      createdAt?: unknown;
      id?: unknown;
    };

    if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") {
      throw new Error("Invalid cursor shape");
    }

    return {
      createdAt: parsed.createdAt,
      id: parsed.id
    };
  } catch (_error) {
    throw new AdminDropServiceError("Invalid cursor.", 400, "INVALID_CURSOR");
  }
}

function requireUuid(value: string, field: string): string {
  const normalized = value.trim();
  if (!UUID_REGEX.test(normalized)) {
    throw new AdminDropServiceError(`${field} must be a valid UUID.`, 400, "INVALID_UUID", { field });
  }

  return normalized;
}

function isRarityTier(value: unknown): value is RarityTier {
  return typeof value === "string" && (RARITY_TIERS as readonly string[]).includes(value);
}

function isPackTier(value: unknown): value is PackTier {
  return typeof value === "string" && (PACK_TIERS as readonly string[]).includes(value);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function parseJsonStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const output: string[] = [];
  for (const value of input) {
    if (typeof value === "string") {
      output.push(value);
    }
  }

  return uniqueSorted(output);
}

function parseJsonRarityArray(input: unknown): RarityTier[] {
  if (!Array.isArray(input)) {
    return [...RARITY_TIERS];
  }

  const output: RarityTier[] = [];
  for (const value of input) {
    if (isRarityTier(value)) {
      output.push(value);
    }
  }

  const deduped = [...new Set(output)];
  return deduped.length > 0 ? deduped : [...RARITY_TIERS];
}

function parseEligibleCountsJson(input: unknown): Record<RarityTier, number> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return defaultEligibleCounts();
  }

  const source = input as Record<string, unknown>;
  const output = defaultEligibleCounts();
  for (const rarity of RARITY_TIERS) {
    const raw = source[rarity];
    const parsed = typeof raw === "number" ? raw : Number(raw);
    output[rarity] = Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
  }

  return output;
}

function normalizeTierCompositionInput(
  tier: PackTier,
  composition: AdminDropTierCompositionInput
): AdminDropTierCompositionInput {
  const setKeys = uniqueSorted(
    (composition.setKeys ?? [])
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  );

  const includedRarities = [...new Set((composition.includedRarities ?? []).filter((value) => isRarityTier(value)))];
  if (includedRarities.length === 0) {
    throw new AdminDropServiceError("At least one rarity must be selected.", 400, "INVALID_DROP_CONFIGURATION", {
      tier,
      field: "includedRarities"
    });
  }

  const explicitIncludeCardIds = uniqueSorted(
    (composition.explicitIncludeCardIds ?? [])
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      .map((value) => requireUuid(value, "explicitIncludeCardId"))
  );

  const explicitExcludeCardIds = uniqueSorted(
    (composition.explicitExcludeCardIds ?? [])
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      .map((value) => requireUuid(value, "explicitExcludeCardId"))
  );

  if (explicitIncludeCardIds.length > MAX_EXPLICIT_CARD_IDS_PER_TIER) {
    throw new AdminDropServiceError("Too many explicit include cards for a tier.", 400, "INVALID_DROP_CONFIGURATION", {
      tier,
      max: MAX_EXPLICIT_CARD_IDS_PER_TIER,
      field: "explicitIncludeCardIds"
    });
  }

  if (explicitExcludeCardIds.length > MAX_EXPLICIT_CARD_IDS_PER_TIER) {
    throw new AdminDropServiceError("Too many explicit exclude cards for a tier.", 400, "INVALID_DROP_CONFIGURATION", {
      tier,
      max: MAX_EXPLICIT_CARD_IDS_PER_TIER,
      field: "explicitExcludeCardIds"
    });
  }

  return {
    setKeys,
    includedRarities,
    explicitIncludeCardIds,
    explicitExcludeCardIds
  };
}

function parseMutationInput(input: AdminDropMutationInput): {
  name: string;
  scheduledAtIso: string;
  lotteryEnabled: boolean;
  maxPacksPerUser: number;
  tiers: AdminDropTierInput[];
} {
  const name = input.name?.trim() ?? "";
  if (name.length === 0 || name.length > 120) {
    throw new AdminDropServiceError("Drop name must be between 1 and 120 characters.", 400, "INVALID_DROP_CONFIGURATION", {
      field: "name"
    });
  }

  const scheduledAt = new Date(input.scheduledAt);
  if (!Number.isFinite(scheduledAt.getTime())) {
    throw new AdminDropServiceError("scheduledAt must be a valid ISO timestamp.", 400, "INVALID_DROP_CONFIGURATION", {
      field: "scheduledAt"
    });
  }

  if (typeof input.lotteryEnabled !== "boolean") {
    throw new AdminDropServiceError("lotteryEnabled must be a boolean.", 400, "INVALID_DROP_CONFIGURATION", {
      field: "lotteryEnabled"
    });
  }

  const maxPacksPerUser = Math.trunc(Number(input.maxPacksPerUser));
  if (!Number.isFinite(maxPacksPerUser) || maxPacksPerUser < 1 || maxPacksPerUser > 25) {
    throw new AdminDropServiceError("maxPacksPerUser must be between 1 and 25.", 400, "INVALID_DROP_CONFIGURATION", {
      field: "maxPacksPerUser"
    });
  }

  if (!Array.isArray(input.tiers) || input.tiers.length !== PACK_TIERS.length) {
    throw new AdminDropServiceError("All pack tiers must be provided.", 400, "INVALID_DROP_CONFIGURATION", {
      field: "tiers"
    });
  }

  const byTier = new Map<PackTier, AdminDropTierInput>();

  for (const rawTier of input.tiers) {
    if (!rawTier || typeof rawTier !== "object" || !isPackTier(rawTier.tier)) {
      throw new AdminDropServiceError("Tier payload is invalid.", 400, "INVALID_DROP_CONFIGURATION", {
        field: "tiers"
      });
    }

    if (byTier.has(rawTier.tier)) {
      throw new AdminDropServiceError("Duplicate tier payload detected.", 400, "INVALID_DROP_CONFIGURATION", {
        tier: rawTier.tier
      });
    }

    const price = Math.trunc(Number(rawTier.price));
    if (!Number.isFinite(price) || price < 50) {
      throw new AdminDropServiceError("Tier price must be at least 50 cents.", 400, "INVALID_DROP_CONFIGURATION", {
        tier: rawTier.tier,
        field: "price"
      });
    }

    const totalInventory = Math.trunc(Number(rawTier.totalInventory));
    if (!Number.isFinite(totalInventory) || totalInventory < 1 || totalInventory > 100_000) {
      throw new AdminDropServiceError("Tier inventory must be between 1 and 100000.", 400, "INVALID_DROP_CONFIGURATION", {
        tier: rawTier.tier,
        field: "totalInventory"
      });
    }

    byTier.set(rawTier.tier, {
      tier: rawTier.tier,
      price,
      totalInventory,
      composition: normalizeTierCompositionInput(rawTier.tier, rawTier.composition)
    });
  }

  for (const tier of PACK_TIERS) {
    if (!byTier.has(tier)) {
      throw new AdminDropServiceError("Missing tier payload.", 400, "INVALID_DROP_CONFIGURATION", { tier });
    }
  }

  return {
    name,
    scheduledAtIso: scheduledAt.toISOString(),
    lotteryEnabled: input.lotteryEnabled,
    maxPacksPerUser,
    tiers: PACK_TIERS.map((tier) => byTier.get(tier) as AdminDropTierInput)
  };
}

function requiredRaritiesForTier(tier: PackTier): RarityTier[] {
  const config = PACK_TIER_CONFIGS[tier];
  const required = new Set<RarityTier>();

  for (const slot of config.slots) {
    for (const entry of slot) {
      if (entry.weight > 0) {
        required.add(entry.rarity);
      }
    }
  }

  return [...required];
}

function buildPreviewForTier(context: TierContext): AdminDropTierPreview {
  const tierConfig = PACK_TIER_CONFIGS[context.tier];

  return {
    tier: context.tier,
    cardsPerPack: tierConfig.cardsPerPack,
    slots: tierConfig.slots.map((slot) => slot.map((entry) => ({ rarity: entry.rarity, weight: entry.weight }))),
    eligibleCounts: context.eligibleCounts,
    requiredPerRarity: tierConfig.cardsPerPack,
    readiness: {
      ready: context.readinessIssues.length === 0,
      issues: context.readinessIssues
    }
  };
}

async function fetchCardsByIds(client: Queryable, cardIds: string[]): Promise<Map<string, RarityTier>> {
  if (cardIds.length === 0) {
    return new Map();
  }

  const result = await client.query<EligibleCardRow>(
    `SELECT id, rarity_tier
     FROM pokemon_cards
     WHERE id = ANY($1::uuid[])`,
    [cardIds]
  );

  if (result.rowCount !== cardIds.length) {
    const found = new Set(result.rows.map((row) => row.id));
    const missing = cardIds.filter((cardId) => !found.has(cardId));
    throw new AdminDropServiceError("One or more explicit card IDs were not found.", 400, "INVALID_DROP_CONFIGURATION", {
      missingCardIds: missing
    });
  }

  return new Map(result.rows.map((row) => [row.id, row.rarity_tier]));
}

async function compileTierContexts(client: Queryable, tiers: AdminDropTierInput[]): Promise<TierContext[]> {
  const contexts: TierContext[] = [];

  for (const tierInput of tiers) {
    const composition = tierInput.composition;
    const setKeysParam = composition.setKeys.length > 0 ? composition.setKeys : null;

    const baseCards = await client.query<EligibleCardRow>(
      `SELECT id, rarity_tier
       FROM pokemon_cards
       WHERE rarity_tier = ANY($1::text[])
         AND ($2::text[] IS NULL OR COALESCE(set_id, '__name__:' || set_name) = ANY($2::text[]))`,
      [composition.includedRarities, setKeysParam]
    );

    const allExplicitCardIds = uniqueSorted([
      ...composition.explicitIncludeCardIds,
      ...composition.explicitExcludeCardIds
    ]);
    const explicitCardsById = await fetchCardsByIds(client, allExplicitCardIds);

    const eligibleByRarity = {
      common: new Set<string>(),
      uncommon: new Set<string>(),
      rare: new Set<string>(),
      holo_rare: new Set<string>(),
      ultra_rare: new Set<string>(),
      chase: new Set<string>()
    } as Record<RarityTier, Set<string>>;

    for (const card of baseCards.rows) {
      eligibleByRarity[card.rarity_tier].add(card.id);
    }

    for (const cardId of composition.explicitIncludeCardIds) {
      const rarity = explicitCardsById.get(cardId);
      if (rarity) {
        eligibleByRarity[rarity].add(cardId);
      }
    }

    for (const cardId of composition.explicitExcludeCardIds) {
      const rarity = explicitCardsById.get(cardId);
      if (rarity) {
        eligibleByRarity[rarity].delete(cardId);
      }
    }

    const eligibleCardIdsByRarity = {
      common: uniqueSorted([...eligibleByRarity.common]),
      uncommon: uniqueSorted([...eligibleByRarity.uncommon]),
      rare: uniqueSorted([...eligibleByRarity.rare]),
      holo_rare: uniqueSorted([...eligibleByRarity.holo_rare]),
      ultra_rare: uniqueSorted([...eligibleByRarity.ultra_rare]),
      chase: uniqueSorted([...eligibleByRarity.chase])
    } as Record<RarityTier, string[]>;

    const eligibleCounts = {
      common: eligibleCardIdsByRarity.common.length,
      uncommon: eligibleCardIdsByRarity.uncommon.length,
      rare: eligibleCardIdsByRarity.rare.length,
      holo_rare: eligibleCardIdsByRarity.holo_rare.length,
      ultra_rare: eligibleCardIdsByRarity.ultra_rare.length,
      chase: eligibleCardIdsByRarity.chase.length
    };

    const requiredCount = PACK_TIER_CONFIGS[tierInput.tier].cardsPerPack;
    const readinessIssues = requiredRaritiesForTier(tierInput.tier)
      .map((rarity) => ({
        rarity,
        required: requiredCount,
        actual: eligibleCounts[rarity]
      }))
      .filter((entry) => entry.actual < entry.required);

    contexts.push({
      tier: tierInput.tier,
      price: tierInput.price,
      totalInventory: tierInput.totalInventory,
      normalizedComposition: composition,
      eligibleCardIdsByRarity,
      eligibleCounts,
      readinessIssues
    });
  }

  return contexts;
}

function buildWeightsByTierFromConfigs(): GenerationWeightsByTier {
  const weights = {} as GenerationWeightsByTier;

  for (const tier of PACK_TIERS) {
    const config = PACK_TIER_CONFIGS[tier];
    weights[tier] = {
      cardsPerPack: config.cardsPerPack,
      slots: config.slots.map((slot) => slot.map((entry) => ({ rarity: entry.rarity, weight: entry.weight })))
    };
  }

  return weights;
}

function buildEligibleByTierFromContexts(contexts: TierContext[]): GenerationEligibleIdsByTier {
  const byTier = {} as GenerationEligibleIdsByTier;

  for (const context of contexts) {
    byTier[context.tier] = context.eligibleCardIdsByRarity;
  }

  return byTier;
}

async function upsertTierCompositions(client: Queryable, dropId: string, contexts: TierContext[]): Promise<void> {
  for (const context of contexts) {
    await client.query(
      `INSERT INTO drop_tier_compositions (
         drop_id,
         tier,
         set_keys_json,
         included_rarities_json,
         explicit_include_card_ids_json,
         explicit_exclude_card_ids_json,
         eligible_counts_json,
         updated_at
       )
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, now())
       ON CONFLICT (drop_id, tier)
       DO UPDATE
       SET set_keys_json = EXCLUDED.set_keys_json,
           included_rarities_json = EXCLUDED.included_rarities_json,
           explicit_include_card_ids_json = EXCLUDED.explicit_include_card_ids_json,
           explicit_exclude_card_ids_json = EXCLUDED.explicit_exclude_card_ids_json,
           eligible_counts_json = EXCLUDED.eligible_counts_json,
           updated_at = now()`,
      [
        dropId,
        context.tier,
        JSON.stringify(context.normalizedComposition.setKeys),
        JSON.stringify(context.normalizedComposition.includedRarities),
        JSON.stringify(context.normalizedComposition.explicitIncludeCardIds),
        JSON.stringify(context.normalizedComposition.explicitExcludeCardIds),
        JSON.stringify(context.eligibleCounts)
      ]
    );
  }
}

async function replaceDropPacks(client: Queryable, dropId: string, contexts: TierContext[]): Promise<void> {
  for (const context of contexts) {
    await client.query(
      `INSERT INTO drop_packs (drop_id, tier, price, total_inventory, remaining_inventory, status)
       VALUES ($1, $2, $3, $4, $4, 'active')
       ON CONFLICT (drop_id, tier)
       DO UPDATE
       SET price = EXCLUDED.price,
           total_inventory = EXCLUDED.total_inventory,
           remaining_inventory = EXCLUDED.remaining_inventory,
           status = EXCLUDED.status`,
      [dropId, context.tier, context.price, context.totalInventory]
    );
  }
}

function assertActivationReadiness(contexts: TierContext[]): void {
  const failures = contexts
    .flatMap((context) =>
      context.readinessIssues.map((issue) => ({
        tier: context.tier,
        rarity: issue.rarity,
        required: issue.required,
        actual: issue.actual
      }))
    );

  if (failures.length > 0) {
    throw new AdminDropServiceError(
      "Pack composition pool is too small for activation. Add cards or widen filters.",
      409,
      "COMPOSITION_POOL_TOO_SMALL",
      { failures }
    );
  }
}

async function loadDropRowsByIds(client: Queryable, dropIds: string[]): Promise<Map<string, DropRow>> {
  const rows = await client.query<DropRow>(
    `SELECT id,
            COALESCE(name, $2) AS name,
            status,
            scheduled_at,
            lottery_enabled,
            max_packs_per_user,
            published_at,
            created_at,
            updated_at
     FROM drops
     WHERE id = ANY($1::uuid[])
     ORDER BY created_at DESC, id DESC`,
    [dropIds, DEFAULT_DROP_NAME]
  );

  return new Map(rows.rows.map((row) => [row.id, row]));
}

async function loadTierRowsByDropIds(client: Queryable, dropIds: string[]): Promise<Map<string, TierRow[]>> {
  const rows = await client.query<TierRow>(
    `SELECT dp.drop_id,
            dp.tier,
            dp.price,
            dp.total_inventory,
            dp.remaining_inventory,
            dtc.set_keys_json,
            dtc.included_rarities_json,
            dtc.explicit_include_card_ids_json,
            dtc.explicit_exclude_card_ids_json,
            dtc.eligible_counts_json
     FROM drop_packs dp
     LEFT JOIN drop_tier_compositions dtc
       ON dtc.drop_id = dp.drop_id
      AND dtc.tier = dp.tier
     WHERE dp.drop_id = ANY($1::uuid[])
     ORDER BY dp.tier ASC`,
    [dropIds]
  );

  const grouped = new Map<string, TierRow[]>();
  for (const row of rows.rows) {
    if (!grouped.has(row.drop_id)) {
      grouped.set(row.drop_id, []);
    }
    grouped.get(row.drop_id)?.push(row);
  }

  return grouped;
}

async function loadLotteryStatsByDropIds(client: Queryable, dropIds: string[]): Promise<Map<string, AdminDropLotteryStats>> {
  const rows = await client.query<LotteryStatsRow>(
    `SELECT (evidence_json ->> 'dropId') AS drop_id,
            COUNT(*) FILTER (WHERE event_type = 'lottery_win')::BIGINT AS wins,
            COUNT(*) FILTER (WHERE event_type = 'lottery_loss')::BIGINT AS losses,
            COUNT(*) FILTER (WHERE event_type = 'lottery_unavailable')::BIGINT AS unavailable
     FROM security_events
     WHERE event_type IN ('lottery_win', 'lottery_loss', 'lottery_unavailable')
       AND (evidence_json ->> 'dropId') = ANY($1::text[])
     GROUP BY (evidence_json ->> 'dropId')`,
    [dropIds]
  );

  return new Map(
    rows.rows.map((row) => [
      row.drop_id,
      {
        wins: Number(row.wins),
        losses: Number(row.losses),
        unavailable: Number(row.unavailable)
      }
    ])
  );
}

async function loadSchedulerStatsByDropIds(client: Queryable, dropIds: string[]): Promise<Map<string, AdminDropSchedulerStats>> {
  const rows = await client.query<SchedulerStatsRow>(
    `SELECT (evidence_json ->> 'dropId') AS drop_id,
            COUNT(*)::BIGINT AS issue_count,
            MAX(created_at) AS last_issue_at
     FROM security_events
     WHERE event_type LIKE 'drop_scheduler_%'
       AND (evidence_json ->> 'dropId') = ANY($1::text[])
     GROUP BY (evidence_json ->> 'dropId')`,
    [dropIds]
  );

  return new Map(
    rows.rows.map((row) => [
      row.drop_id,
      {
        issueCount: Number(row.issue_count),
        lastIssueAt: row.last_issue_at
      }
    ])
  );
}

function mapTierRow(row: TierRow): AdminDropTierView {
  const composition: AdminDropTierCompositionInput = {
    setKeys: parseJsonStringArray(row.set_keys_json),
    includedRarities: parseJsonRarityArray(row.included_rarities_json),
    explicitIncludeCardIds: parseJsonStringArray(row.explicit_include_card_ids_json),
    explicitExcludeCardIds: parseJsonStringArray(row.explicit_exclude_card_ids_json)
  };

  const eligibleCounts = parseEligibleCountsJson(row.eligible_counts_json);
  const cardsPerPack = PACK_TIER_CONFIGS[row.tier].cardsPerPack;
  const slots = PACK_TIER_CONFIGS[row.tier].slots.map((slot) => slot.map((entry) => ({ rarity: entry.rarity, weight: entry.weight })));

  const totalInventory = Number(row.total_inventory);
  const remainingInventory = Number(row.remaining_inventory);

  return {
    tier: row.tier,
    price: Number(row.price),
    totalInventory,
    remainingInventory,
    consumedInventory: Math.max(0, totalInventory - remainingInventory),
    cardsPerPack,
    slots,
    composition,
    eligibleCounts
  };
}

function mapDropView(input: {
  dropRow: DropRow;
  tierRows: TierRow[];
  lotteryStats: AdminDropLotteryStats | undefined;
  schedulerStats: AdminDropSchedulerStats | undefined;
}): AdminDropView {
  const tiers = input.tierRows.map((row) => mapTierRow(row));
  const totals = tiers.reduce(
    (acc, tier) => {
      acc.total += tier.totalInventory;
      acc.remaining += tier.remainingInventory;
      acc.consumed += tier.consumedInventory;
      return acc;
    },
    { total: 0, remaining: 0, consumed: 0 }
  );

  return {
    id: input.dropRow.id,
    name: input.dropRow.name,
    status: input.dropRow.status,
    scheduledAt: input.dropRow.scheduled_at,
    lotteryEnabled: Boolean(input.dropRow.lottery_enabled),
    maxPacksPerUser: Number(input.dropRow.max_packs_per_user),
    publishedAt: input.dropRow.published_at,
    createdAt: input.dropRow.created_at,
    updatedAt: input.dropRow.updated_at,
    tiers,
    inventory: totals,
    lottery: input.lotteryStats ?? { wins: 0, losses: 0, unavailable: 0 },
    scheduler: input.schedulerStats ?? { issueCount: 0, lastIssueAt: null }
  };
}

export async function previewAdminDropComposition(input: AdminDropMutationInput): Promise<AdminDropPreview> {
  const parsed = parseMutationInput(input);

  return withTransaction(async (client) => {
    const contexts = await compileTierContexts(client, parsed.tiers);
    const tiers = contexts.map((context) => buildPreviewForTier(context));

    return {
      tiers,
      overallReady: tiers.every((tier) => tier.readiness.ready)
    };
  });
}

async function resolveGenerationVersionIdForContexts(client: Queryable, contexts: TierContext[]): Promise<string> {
  const weightsByTier = buildWeightsByTierFromConfigs();
  const eligibleCardIdsByTier = buildEligibleByTierFromContexts(contexts);
  const anchorSnapshot = await buildAnchorSnapshotFromCatalog(client);

  const version = await ensureGenerationVersion(client, {
    algorithmVersion: GENERATION_VERSION_ALGORITHM,
    weightsByTier,
    eligibleCardIdsByTier,
    anchorSnapshot
  });

  return version.id;
}

export async function createAdminDropDraft(input: AdminDropMutationInput): Promise<AdminDropView> {
  const parsed = parseMutationInput(input);

  return withTransaction(async (client) => {
    const contexts = await compileTierContexts(client, parsed.tiers);
    const generationVersionId = await resolveGenerationVersionIdForContexts(client, contexts);

    const insertedDrop = await client.query<{ id: string }>(
      `INSERT INTO drops (
         name,
         scheduled_at,
         status,
         lottery_enabled,
         max_packs_per_user,
         active_generation_version_id,
         updated_at
       )
       VALUES ($1, $2, 'draft', $3, $4, $5, now())
       RETURNING id`,
      [parsed.name, parsed.scheduledAtIso, parsed.lotteryEnabled, parsed.maxPacksPerUser, generationVersionId]
    );

    const dropId = insertedDrop.rows[0].id;

    await replaceDropPacks(client, dropId, contexts);
    await upsertTierCompositions(client, dropId, contexts);

    const view = await getAdminDropByIdWithinTransaction(client, dropId);
    if (!view) {
      throw new AdminDropServiceError("Failed to load created drop.", 500, "ADMIN_DROP_ERROR");
    }

    return view;
  });
}

export async function updateAdminDrop(dropId: string, input: AdminDropMutationInput): Promise<AdminDropView> {
  const parsed = parseMutationInput(input);

  return withTransaction(async (client) => {
    const locked = await client.query<{ id: string; status: AdminDropStatus }>(
      `SELECT id, status
       FROM drops
       WHERE id = $1
       FOR UPDATE`,
      [dropId]
    );

    if (locked.rowCount !== 1) {
      throw new AdminDropServiceError("Drop not found.", 404, "DROP_NOT_FOUND", { dropId });
    }

    const currentStatus = locked.rows[0].status;
    if (currentStatus !== "draft" && currentStatus !== "upcoming") {
      throw new AdminDropServiceError(
        "Only draft or upcoming drops can be edited.",
        409,
        "DROP_NOT_EDITABLE",
        { dropId, status: currentStatus }
      );
    }

    const contexts = await compileTierContexts(client, parsed.tiers);
    if (currentStatus === "upcoming") {
      assertActivationReadiness(contexts);
    }

    const generationVersionId = await resolveGenerationVersionIdForContexts(client, contexts);

    await client.query(
      `UPDATE drops
       SET name = $2,
           scheduled_at = $3,
           lottery_enabled = $4,
           max_packs_per_user = $5,
           active_generation_version_id = $6,
           updated_at = now()
       WHERE id = $1`,
      [dropId, parsed.name, parsed.scheduledAtIso, parsed.lotteryEnabled, parsed.maxPacksPerUser, generationVersionId]
    );

    await replaceDropPacks(client, dropId, contexts);
    await upsertTierCompositions(client, dropId, contexts);

    const view = await getAdminDropByIdWithinTransaction(client, dropId);
    if (!view) {
      throw new AdminDropServiceError("Drop not found after update.", 404, "DROP_NOT_FOUND", { dropId });
    }

    return view;
  });
}

export async function publishAdminDrop(dropId: string): Promise<AdminDropView> {
  return withTransaction(async (client) => {
    const locked = await client.query<{ id: string; status: AdminDropStatus }>(
      `SELECT id, status
       FROM drops
       WHERE id = $1
       FOR UPDATE`,
      [dropId]
    );

    if (locked.rowCount !== 1) {
      throw new AdminDropServiceError("Drop not found.", 404, "DROP_NOT_FOUND", { dropId });
    }

    if (locked.rows[0].status !== "draft") {
      throw new AdminDropServiceError(
        "Only draft drops can be published.",
        409,
        "DROP_NOT_PUBLISHABLE",
        { dropId, status: locked.rows[0].status }
      );
    }

    const tierRows = await loadTierRowsByDropIds(client, [dropId]);
    const dropTierRows = tierRows.get(dropId) ?? [];

    if (dropTierRows.length !== PACK_TIERS.length) {
      throw new AdminDropServiceError("Drop tier configuration is incomplete.", 409, "INVALID_DROP_CONFIGURATION", {
        dropId
      });
    }

    const contexts: TierContext[] = dropTierRows.map((row) => {
      const tier = row.tier;
      const eligibleCounts = parseEligibleCountsJson(row.eligible_counts_json);
      const required = PACK_TIER_CONFIGS[tier].cardsPerPack;
      const issues = requiredRaritiesForTier(tier)
        .map((rarity) => ({ rarity, required, actual: eligibleCounts[rarity] }))
        .filter((issue) => issue.actual < issue.required);

      return {
        tier,
        price: Number(row.price),
        totalInventory: Number(row.total_inventory),
        normalizedComposition: {
          setKeys: parseJsonStringArray(row.set_keys_json),
          includedRarities: parseJsonRarityArray(row.included_rarities_json),
          explicitIncludeCardIds: parseJsonStringArray(row.explicit_include_card_ids_json),
          explicitExcludeCardIds: parseJsonStringArray(row.explicit_exclude_card_ids_json)
        },
        eligibleCardIdsByRarity: {
          common: [],
          uncommon: [],
          rare: [],
          holo_rare: [],
          ultra_rare: [],
          chase: []
        },
        eligibleCounts,
        readinessIssues: issues
      };
    });

    assertActivationReadiness(contexts);

    await client.query(
      `UPDATE drops
       SET status = 'upcoming',
           published_at = now(),
           updated_at = now()
       WHERE id = $1`,
      [dropId]
    );

    const view = await getAdminDropByIdWithinTransaction(client, dropId);
    if (!view) {
      throw new AdminDropServiceError("Drop not found after publish.", 404, "DROP_NOT_FOUND", { dropId });
    }

    return view;
  });
}

async function getAdminDropByIdWithinTransaction(client: Queryable, dropId: string): Promise<AdminDropView | null> {
  const dropsById = await loadDropRowsByIds(client, [dropId]);
  const dropRow = dropsById.get(dropId);

  if (!dropRow) {
    return null;
  }

  const [tiersByDropId, lotteryStatsByDropId, schedulerStatsByDropId] = await Promise.all([
    loadTierRowsByDropIds(client, [dropId]),
    loadLotteryStatsByDropIds(client, [dropId]),
    loadSchedulerStatsByDropIds(client, [dropId])
  ]);

  return mapDropView({
    dropRow,
    tierRows: tiersByDropId.get(dropId) ?? [],
    lotteryStats: lotteryStatsByDropId.get(dropId),
    schedulerStats: schedulerStatsByDropId.get(dropId)
  });
}

export async function getAdminDropById(dropId: string): Promise<AdminDropView | null> {
  return withTransaction(async (client) => getAdminDropByIdWithinTransaction(client, dropId));
}

export async function listAdminDrops(input: {
  cursor?: string | null;
  limit?: number;
  status?: AdminDropStatus | "all";
} = {}): Promise<{ items: AdminDropView[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 20), 1), MAX_DROPS_PAGE_SIZE);
  const cursor = decodeCursor(input.cursor);

  return withTransaction(async (client) => {
    const params: unknown[] = [DEFAULT_DROP_NAME];
    const whereClauses: string[] = [];

    if (input.status && input.status !== "all") {
      params.push(input.status);
      whereClauses.push(`status = $${params.length}`);
    }

    if (cursor) {
      params.push(cursor.createdAt, cursor.id);
      whereClauses.push(`(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }

    params.push(limit + 1);

    const drops = await client.query<DropRow>(
      `SELECT id,
              COALESCE(name, $1) AS name,
              status,
              scheduled_at,
              lottery_enabled,
              max_packs_per_user,
              published_at,
              created_at,
              updated_at
       FROM drops
       ${whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : ""}
       ORDER BY created_at DESC, id DESC
       LIMIT $${params.length}`,
      params
    );

    if (drops.rowCount === 0) {
      return { items: [], nextCursor: null };
    }

    const hasNext = drops.rows.length > limit;
    const pageRows = hasNext ? drops.rows.slice(0, limit) : drops.rows;
    const dropIds = pageRows.map((row) => row.id);

    const [tiersByDropId, lotteryStatsByDropId, schedulerStatsByDropId] = await Promise.all([
      loadTierRowsByDropIds(client, dropIds),
      loadLotteryStatsByDropIds(client, dropIds),
      loadSchedulerStatsByDropIds(client, dropIds)
    ]);

    const items = pageRows.map((dropRow) =>
      mapDropView({
        dropRow,
        tierRows: tiersByDropId.get(dropRow.id) ?? [],
        lotteryStats: lotteryStatsByDropId.get(dropRow.id),
        schedulerStats: schedulerStatsByDropId.get(dropRow.id)
      })
    );

    const nextCursor = hasNext
      ? encodeCursor({
          createdAt: pageRows[pageRows.length - 1].created_at,
          id: pageRows[pageRows.length - 1].id
        })
      : null;

    return {
      items,
      nextCursor
    };
  });
}

export function buildDefaultAdminDropInput(): AdminDropMutationInput {
  return {
    name: DEFAULT_DROP_NAME,
    scheduledAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    lotteryEnabled: true,
    maxPacksPerUser: DEFAULT_MAX_PACKS_PER_USER,
    tiers: PACK_TIERS.map((tier) => ({
      tier,
      price: PACK_TIER_CONFIGS[tier].priceCents,
      totalInventory: 10,
      composition: {
        setKeys: [],
        includedRarities: [...RARITY_TIERS],
        explicitIncludeCardIds: [],
        explicitExcludeCardIds: []
      }
    }))
  };
}
