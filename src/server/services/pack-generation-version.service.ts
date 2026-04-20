import { createHash } from "crypto";
import type { QueryResult, QueryResultRow } from "pg";
import { PACK_TIERS, RARITY_TIERS } from "../../lib/types";
import type { PackTier, RarityTier, SlotDistribution } from "../../lib/types";
import { PACK_TIER_CONFIGS } from "../config/pack-tiers";

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
};

type GenerationVersionRow = {
  id: string;
  version_number: string;
  algorithm_version: string;
  weights_json: unknown;
  eligible_card_ids_json: unknown;
  anchor_snapshot_json: unknown;
  content_hash: string;
};

type CatalogRarityRow = {
  id: string;
  rarity_tier: RarityTier;
};

type AnchorRow = {
  rarity_tier: RarityTier;
  anchor: string | null;
};

export type GenerationWeightsByTier = Record<
  PackTier,
  {
    cardsPerPack: number;
    slots: SlotDistribution[][];
  }
>;

export type GenerationEligibleIdsByTier = Record<PackTier, Record<RarityTier, string[]>>;
export type GenerationAnchorSnapshot = Record<RarityTier, number>;

export type GenerationVersionPayload = {
  weightsByTier: GenerationWeightsByTier;
  eligibleCardIdsByTier: GenerationEligibleIdsByTier;
};

export type GenerationVersion = {
  id: string;
  versionNumber: number;
  algorithmVersion: string;
  payload: GenerationVersionPayload;
  anchorSnapshot: GenerationAnchorSnapshot;
  contentHash: string;
};

export const GENERATION_VERSION_ALGORITHM = "pack-gen-v2-deterministic";
const GENERATION_VERSION_LIFECYCLE_LOCK_CLASS_ID = 51_001;
const GENERATION_VERSION_LIFECYCLE_LOCK_OBJECT_ID = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeSlots(raw: unknown, tier: PackTier): SlotDistribution[][] {
  if (!Array.isArray(raw)) {
    throw new Error(`Invalid generation payload for ${tier}: slots must be an array.`);
  }

  return raw.map((slot, slotIndex) => {
    if (!Array.isArray(slot) || slot.length === 0) {
      throw new Error(`Invalid generation payload for ${tier}: slot ${slotIndex + 1} must be a non-empty array.`);
    }

    const normalized = slot.map((entry) => {
      if (!isRecord(entry) || typeof entry.rarity !== "string" || typeof entry.weight !== "number") {
        throw new Error(`Invalid generation payload for ${tier}: malformed slot weight entry.`);
      }
      return {
        rarity: entry.rarity as RarityTier,
        weight: entry.weight
      };
    });

    return normalized;
  });
}

function normalizeEligibleByRarity(raw: unknown, tier: PackTier): Record<RarityTier, string[]> {
  if (!isRecord(raw)) {
    throw new Error(`Invalid generation payload for ${tier}: eligibleCardIdsByRarity must be an object.`);
  }

  const normalized = {} as Record<RarityTier, string[]>;

  for (const rarity of RARITY_TIERS) {
    const entries = raw[rarity];
    if (!Array.isArray(entries)) {
      throw new Error(`Invalid generation payload for ${tier}: rarity ${rarity} must be an array.`);
    }

    if (!entries.every((entry) => typeof entry === "string")) {
      throw new Error(`Invalid generation payload for ${tier}: rarity ${rarity} must contain card IDs.`);
    }

    normalized[rarity] = [...entries];
  }

  return normalized;
}

function normalizeWeightsByTier(raw: unknown): GenerationWeightsByTier {
  if (!isRecord(raw)) {
    throw new Error("Invalid generation payload: weights_json must be an object.");
  }

  const normalized = {} as GenerationWeightsByTier;

  for (const tier of PACK_TIERS) {
    const tierRaw = raw[tier];
    if (!isRecord(tierRaw)) {
      throw new Error(`Invalid generation payload: missing tier ${tier} in weights_json.`);
    }

    const cardsPerPack = tierRaw.cardsPerPack;
    if (typeof cardsPerPack !== "number" || !Number.isInteger(cardsPerPack) || cardsPerPack <= 0) {
      throw new Error(`Invalid generation payload for ${tier}: cardsPerPack must be a positive integer.`);
    }

    const slots = normalizeSlots(tierRaw.slots, tier);
    if (slots.length !== cardsPerPack) {
      throw new Error(
        `Invalid generation payload for ${tier}: cardsPerPack (${cardsPerPack}) must match slot count (${slots.length}).`
      );
    }

    normalized[tier] = {
      cardsPerPack,
      slots
    };
  }

  return normalized;
}

function normalizeEligibleByTier(raw: unknown): GenerationEligibleIdsByTier {
  if (!isRecord(raw)) {
    throw new Error("Invalid generation payload: eligible_card_ids_json must be an object.");
  }

  const normalized = {} as GenerationEligibleIdsByTier;

  for (const tier of PACK_TIERS) {
    normalized[tier] = normalizeEligibleByRarity(raw[tier], tier);
  }

  return normalized;
}

function normalizeAnchorSnapshot(raw: unknown): GenerationAnchorSnapshot {
  if (!isRecord(raw)) {
    throw new Error("Invalid generation payload: anchor_snapshot_json must be an object.");
  }

  const normalized = {} as GenerationAnchorSnapshot;
  for (const rarity of RARITY_TIERS) {
    const value = raw[rarity];
    if (typeof value !== "number" || Number.isNaN(value)) {
      throw new Error(`Invalid generation payload: anchor for ${rarity} must be a number.`);
    }
    normalized[rarity] = value;
  }

  return normalized;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

function computeContentHash(input: {
  algorithmVersion: string;
  weightsJson: GenerationWeightsByTier;
  eligibleJson: GenerationEligibleIdsByTier;
  anchorSnapshotJson: GenerationAnchorSnapshot;
}): string {
  const canonical = stableStringify({
    algorithmVersion: input.algorithmVersion,
    weightsJson: input.weightsJson,
    eligibleJson: input.eligibleJson,
    anchorSnapshotJson: input.anchorSnapshotJson
  });

  return createHash("sha256").update(canonical).digest("hex");
}

function mapGenerationVersionRow(row: GenerationVersionRow): GenerationVersion {
  const weightsByTier = normalizeWeightsByTier(row.weights_json);
  const eligibleCardIdsByTier = normalizeEligibleByTier(row.eligible_card_ids_json);
  const anchorSnapshot = normalizeAnchorSnapshot(row.anchor_snapshot_json);

  return {
    id: row.id,
    versionNumber: Number(row.version_number),
    algorithmVersion: row.algorithm_version,
    payload: {
      weightsByTier,
      eligibleCardIdsByTier
    },
    anchorSnapshot,
    contentHash: row.content_hash
  };
}

export function buildWeightsByTierFromConfig(): GenerationWeightsByTier {
  const output = {} as GenerationWeightsByTier;

  for (const tier of PACK_TIERS) {
    const config = PACK_TIER_CONFIGS[tier];
    output[tier] = {
      cardsPerPack: config.cardsPerPack,
      slots: config.slots.map((slot) => slot.map((entry) => ({ rarity: entry.rarity, weight: entry.weight })))
    };
  }

  return output;
}

export async function buildEligibleIdsByTierFromCatalog(client: Queryable): Promise<GenerationEligibleIdsByTier> {
  const catalogRows = await client.query<CatalogRarityRow>(
    `SELECT id, rarity_tier
     FROM pokemon_cards
     ORDER BY id ASC`
  );

  const byRarity = new Map<RarityTier, string[]>();
  for (const rarity of RARITY_TIERS) {
    byRarity.set(rarity, []);
  }

  for (const row of catalogRows.rows) {
    byRarity.get(row.rarity_tier)?.push(row.id);
  }

  const result = {} as GenerationEligibleIdsByTier;
  for (const tier of PACK_TIERS) {
    result[tier] = {
      common: [...(byRarity.get("common") ?? [])],
      uncommon: [...(byRarity.get("uncommon") ?? [])],
      rare: [...(byRarity.get("rare") ?? [])],
      holo_rare: [...(byRarity.get("holo_rare") ?? [])],
      ultra_rare: [...(byRarity.get("ultra_rare") ?? [])],
      chase: [...(byRarity.get("chase") ?? [])]
    };
  }

  return result;
}

export async function buildAnchorSnapshotFromCatalog(client: Queryable): Promise<GenerationAnchorSnapshot> {
  const rows = await client.query<AnchorRow>(
    `SELECT rarity_tier,
            AVG(current_price)::numeric(20,4) AS anchor
     FROM pokemon_cards
     GROUP BY rarity_tier`
  );

  const byRarity = new Map<RarityTier, number>();
  for (const row of rows.rows) {
    byRarity.set(row.rarity_tier, row.anchor ? Number(row.anchor) : 0);
  }

  return {
    common: byRarity.get("common") ?? 0,
    uncommon: byRarity.get("uncommon") ?? 0,
    rare: byRarity.get("rare") ?? 0,
    holo_rare: byRarity.get("holo_rare") ?? 0,
    ultra_rare: byRarity.get("ultra_rare") ?? 0,
    chase: byRarity.get("chase") ?? 0
  };
}

export async function ensureGenerationVersion(client: Queryable, input: {
  algorithmVersion: string;
  weightsByTier: GenerationWeightsByTier;
  eligibleCardIdsByTier: GenerationEligibleIdsByTier;
  anchorSnapshot: GenerationAnchorSnapshot;
}): Promise<GenerationVersion> {
  const contentHash = computeContentHash({
    algorithmVersion: input.algorithmVersion,
    weightsJson: input.weightsByTier,
    eligibleJson: input.eligibleCardIdsByTier,
    anchorSnapshotJson: input.anchorSnapshot
  });

  await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
    GENERATION_VERSION_LIFECYCLE_LOCK_CLASS_ID,
    GENERATION_VERSION_LIFECYCLE_LOCK_OBJECT_ID
  ]);

  const existingByContentHash = await client.query<GenerationVersionRow>(
    `SELECT id,
            version_number,
            algorithm_version,
            weights_json,
            eligible_card_ids_json,
            anchor_snapshot_json,
            content_hash
     FROM pack_generation_versions
     WHERE content_hash = $1
     LIMIT 1`,
    [contentHash]
  );

  if (existingByContentHash.rowCount === 1) {
    return mapGenerationVersionRow(existingByContentHash.rows[0]);
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO pack_generation_versions (
       algorithm_version,
       weights_json,
       eligible_card_ids_json,
       anchor_snapshot_json,
       content_hash
     )
     VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5)
     ON CONFLICT (content_hash) DO NOTHING
     RETURNING id`,
    [
      input.algorithmVersion,
      JSON.stringify(input.weightsByTier),
      JSON.stringify(input.eligibleCardIdsByTier),
      JSON.stringify(input.anchorSnapshot),
      contentHash
    ]
  );

  if (inserted.rowCount === 1) {
    const created = await getGenerationVersionById(client, inserted.rows[0].id);
    if (!created) {
      throw new Error("Failed to read inserted generation version.");
    }
    return created;
  }

  const postInsertByContentHash = await client.query<GenerationVersionRow>(
    `SELECT id,
            version_number,
            algorithm_version,
            weights_json,
            eligible_card_ids_json,
            anchor_snapshot_json,
            content_hash
     FROM pack_generation_versions
     WHERE content_hash = $1
     LIMIT 1`,
    [contentHash]
  );

  if (postInsertByContentHash.rowCount !== 1) {
    throw new Error("Failed to resolve generation version after insertion attempt.");
  }

  return mapGenerationVersionRow(postInsertByContentHash.rows[0]);
}

export async function getLatestGenerationVersion(client: Queryable): Promise<GenerationVersion | null> {
  const row = await client.query<GenerationVersionRow>(
    `SELECT id,
            version_number,
            algorithm_version,
            weights_json,
            eligible_card_ids_json,
            anchor_snapshot_json,
            content_hash
     FROM pack_generation_versions
     ORDER BY version_number DESC
     LIMIT 1`
  );

  if (row.rowCount !== 1) {
    return null;
  }

  return mapGenerationVersionRow(row.rows[0]);
}

export async function getGenerationVersionById(client: Queryable, id: string): Promise<GenerationVersion | null> {
  const row = await client.query<GenerationVersionRow>(
    `SELECT id,
            version_number,
            algorithm_version,
            weights_json,
            eligible_card_ids_json,
            anchor_snapshot_json,
            content_hash
     FROM pack_generation_versions
     WHERE id = $1`,
    [id]
  );

  if (row.rowCount !== 1) {
    return null;
  }

  return mapGenerationVersionRow(row.rows[0]);
}

export async function ensureLatestGenerationVersion(client: Queryable): Promise<GenerationVersion> {
  const weightsByTier = buildWeightsByTierFromConfig();
  const eligibleCardIdsByTier = await buildEligibleIdsByTierFromCatalog(client);
  const anchorSnapshot = await buildAnchorSnapshotFromCatalog(client);

  return ensureGenerationVersion(client, {
    algorithmVersion: GENERATION_VERSION_ALGORITHM,
    weightsByTier,
    eligibleCardIdsByTier,
    anchorSnapshot
  });
}
