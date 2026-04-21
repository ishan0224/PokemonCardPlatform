import type { QueryResult, QueryResultRow } from "pg";
import type { PackTier, RarityTier } from "../../lib/types";
import { withTransaction } from "../db/pool";
import type { GenerationVersion, GenerationVersionPayload } from "./pack-generation-version.service";
import { getGenerationVersionById } from "./pack-generation-version.service";
import { decryptServerSeed } from "./fairness.service";

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
};

type FairnessPackRow = {
  pack_id: string;
  drop_id: string;
  tier: PackTier;
  purchased_at: string;
  generation_version_id: string | null;
  server_seed_id: string | null;
  server_seed_hash_at_commit: string | null;
  client_seed: string | null;
  nonce: string | null;
  seed_hash: string | null;
  seed_value_ciphertext: Buffer | null;
  seed_iv: Buffer | null;
  seed_auth_tag: Buffer | null;
  committed_at: string | null;
  revealed_at: string | null;
};

type FairnessMyPackRow = FairnessPackRow & {
  drop_scheduled_at: string;
};

type FairnessPackCardRow = {
  slot_number: number;
  rarity_tier: RarityTier;
  pokemon_card_id: string;
  pokemon_card_name: string;
  pokemon_image_url: string | null;
  pokemon_image_url_hires: string | null;
  pokemon_current_price: string;
};

type FairnessSeedListRow = {
  id: string;
  drop_id: string;
  seed_hash: string;
  committed_at: string;
  revealed_at: string | null;
  next_nonce: string | null;
  has_ciphertext: boolean;
};

type CountRow = {
  count: string;
};

type FairnessAdminDropSummaryRow = {
  drop_id: string;
  drop_scheduled_at: string;
  drop_status: string;
  pack_count: string;
  verifiable_count: string;
  unrevealed_count: string;
  decrypt_failed_count: string;
  legacy_count: string;
  latest_pack_id: string | null;
};

export type FairnessVerificationStatus =
  | "VERIFIABLE"
  | "SEED_UNREVEALED"
  | "SEED_DECRYPTION_FAILED"
  | "UNVERIFIABLE_LEGACY_PACK";

export type FairnessPackCard = {
  slotNumber: number;
  rarityTier: RarityTier;
  pokemonCardId: string;
  pokemonCard: {
    name: string;
    imageUrl: string | null;
    imageUrlHires: string | null;
    currentPrice: number;
  };
};

export type FairnessPackView = {
  packId: string;
  dropId: string;
  tier: PackTier;
  purchasedAt: string;
  verificationStatus: FairnessVerificationStatus;
  verificationError: string | null;
  generationVersion: {
    id: string;
    versionNumber: number;
    algorithmVersion: string;
    payload: GenerationVersionPayload;
  } | null;
  commitment: {
    serverSeedId: string;
    serverSeedHashAtCommit: string;
    clientSeed: string;
    nonce: string;
    committedAt: string;
  } | null;
  seed: {
    seedHash: string;
    revealedAt: string | null;
    seedValue: string | null;
  } | null;
  cards: FairnessPackCard[];
};

export type FairnessSeedStatusFilter = "all" | "revealed" | "unrevealed";

export type FairnessSeedSummary = {
  id: string;
  dropId: string;
  seedHash: string;
  committedAt: string;
  revealedAt: string | null;
  status: "revealed" | "unrevealed";
  nextNonce: string | null;
  hasCiphertext: boolean;
};

export type FairnessSeedListResult = {
  seeds: FairnessSeedSummary[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type FairnessMyPacksCursor = {
  purchasedAt: string;
  packId: string;
};

export type FairnessMyPackSummary = {
  id: string;
  tier: PackTier;
  dropId: string;
  dropScheduledAt: string;
  purchasedAt: string;
  verificationStatus: FairnessVerificationStatus;
};

export type FairnessMyPacksResult = {
  packs: FairnessMyPackSummary[];
  nextCursor: string | null;
};

export type FairnessAdminDropSummary = {
  dropId: string;
  dropScheduledAt: string;
  dropStatus: string;
  packCount: number;
  verifiableCount: number;
  unrevealedCount: number;
  decryptFailedCount: number;
  legacyCount: number;
  latestPackId: string | null;
};

export class FairnessQueryServiceError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, statusCode = 400, code = "FAIRNESS_QUERY_ERROR", details?: Record<string, unknown>) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FAIRNESS_MY_PACKS_DEFAULT_LIMIT = 20;
const FAIRNESS_MY_PACKS_MAX_LIMIT = 50;

function normalizeMyPacksLimit(limit?: number): number {
  if (!Number.isFinite(limit)) {
    return FAIRNESS_MY_PACKS_DEFAULT_LIMIT;
  }

  return Math.min(FAIRNESS_MY_PACKS_MAX_LIMIT, Math.max(1, Math.trunc(limit as number)));
}

function isLegacyFairnessPack(row: {
  generation_version_id: string | null;
  server_seed_id: string | null;
  server_seed_hash_at_commit: string | null;
  client_seed: string | null;
  nonce: string | null;
  seed_hash: string | null;
  committed_at: string | null;
}): boolean {
  return (
    !row.generation_version_id ||
    !row.server_seed_id ||
    !row.server_seed_hash_at_commit ||
    !row.client_seed ||
    !row.nonce ||
    !row.seed_hash ||
    !row.committed_at
  );
}

type VerificationResolution = {
  status: FairnessVerificationStatus;
  error: string | null;
  seedValue: string | null;
};

function resolveVerificationForUnrevealedPack(): VerificationResolution {
  return {
    status: "SEED_UNREVEALED",
    error: null,
    seedValue: null
  };
}

function resolveLegacyVerification(): VerificationResolution {
  return {
    status: "UNVERIFIABLE_LEGACY_PACK",
    error: "UNVERIFIABLE_LEGACY_PACK",
    seedValue: null
  };
}

function resolveVerificationForRevealedPack(row: {
  seed_hash: string | null;
  seed_value_ciphertext: Buffer | null;
  seed_iv: Buffer | null;
  seed_auth_tag: Buffer | null;
}): VerificationResolution {
  try {
    if (!row.seed_value_ciphertext || !row.seed_iv || !row.seed_auth_tag || !row.seed_hash) {
      throw new Error("Seed encryption columns are missing.");
    }

    const seedValue = decryptServerSeed({
      seedValueCiphertext: row.seed_value_ciphertext,
      seedIv: row.seed_iv,
      seedAuthTag: row.seed_auth_tag,
      seedHash: row.seed_hash
    });

    return {
      status: "VERIFIABLE",
      error: null,
      seedValue
    };
  } catch (error) {
    return {
      status: "SEED_DECRYPTION_FAILED",
      error: error instanceof Error ? error.message : "Seed decryption failed.",
      seedValue: null
    };
  }
}

function resolveFairnessVerification(row: {
  revealed_at: string | null;
  generation_version_id: string | null;
  server_seed_id: string | null;
  server_seed_hash_at_commit: string | null;
  client_seed: string | null;
  nonce: string | null;
  seed_hash: string | null;
  seed_value_ciphertext: Buffer | null;
  seed_iv: Buffer | null;
  seed_auth_tag: Buffer | null;
  committed_at: string | null;
}): VerificationResolution {
  if (isLegacyFairnessPack(row)) {
    return resolveLegacyVerification();
  }

  if (!row.revealed_at) {
    return resolveVerificationForUnrevealedPack();
  }

  return resolveVerificationForRevealedPack(row);
}

function parseDateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new FairnessQueryServiceError("date must be YYYY-MM-DD.", 400, "INVALID_DATE");
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new FairnessQueryServiceError("date must be YYYY-MM-DD.", 400, "INVALID_DATE");
  }

  return parsed;
}

export function encodeFairnessMyPacksCursor(cursor: FairnessMyPacksCursor): string {
  return Buffer.from(
    JSON.stringify({
      purchasedAt: cursor.purchasedAt,
      packId: cursor.packId
    }),
    "utf8"
  ).toString("base64url");
}

export function decodeFairnessMyPacksCursor(rawCursor: string): FairnessMyPacksCursor {
  try {
    const decoded = Buffer.from(rawCursor, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as Partial<FairnessMyPacksCursor>;
    const purchasedAt = typeof parsed.purchasedAt === "string" ? parsed.purchasedAt : null;
    const packId = typeof parsed.packId === "string" ? parsed.packId : null;

    if (!purchasedAt || !packId || !UUID_REGEX.test(packId) || Number.isNaN(Date.parse(purchasedAt))) {
      throw new Error("Cursor shape invalid.");
    }

    return { purchasedAt, packId };
  } catch (_error) {
    throw new FairnessQueryServiceError("cursor is invalid.", 400, "INVALID_CURSOR");
  }
}

async function listPackCards(client: Queryable, packId: string): Promise<FairnessPackCard[]> {
  const cards = await client.query<FairnessPackCardRow>(
    `SELECT c.slot_number,
            c.rarity_tier,
            c.pokemon_card_id,
            pc.name AS pokemon_card_name,
            pc.image_url AS pokemon_image_url,
            pc.image_url_hires AS pokemon_image_url_hires,
            pc.current_price::text AS pokemon_current_price
     FROM cards c
     JOIN pokemon_cards pc ON pc.id = c.pokemon_card_id
     WHERE c.pack_id = $1
     ORDER BY c.slot_number ASC`,
    [packId]
  );

  return cards.rows.map((row) => ({
    slotNumber: row.slot_number,
    rarityTier: row.rarity_tier,
    pokemonCardId: row.pokemon_card_id,
    pokemonCard: {
      name: row.pokemon_card_name,
      imageUrl: row.pokemon_image_url,
      imageUrlHires: row.pokemon_image_url_hires,
      currentPrice: Number(row.pokemon_current_price)
    }
  }));
}

function toGenerationVersionView(version: GenerationVersion): FairnessPackView["generationVersion"] {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    algorithmVersion: version.algorithmVersion,
    payload: version.payload
  };
}

export async function getFairnessPackView(packId: string): Promise<FairnessPackView> {
  return withTransaction(async (client) => {
    const packResult = await client.query<FairnessPackRow>(
      `SELECT p.id AS pack_id,
              dp.drop_id,
              p.tier,
              p.purchased_at,
              p.generation_version_id,
              pc.server_seed_id,
              pc.server_seed_hash_at_commit,
              pc.client_seed,
              pc.nonce::text,
              ss.seed_hash,
              ss.seed_value_ciphertext,
              ss.seed_iv,
              ss.seed_auth_tag,
              ss.committed_at,
              ss.revealed_at
       FROM packs p
       JOIN drop_packs dp ON dp.id = p.drop_pack_id
       LEFT JOIN pack_commitments pc ON pc.pack_id = p.id
       LEFT JOIN server_seeds ss ON ss.id = pc.server_seed_id
       WHERE p.id = $1`,
      [packId]
    );

    if (packResult.rowCount !== 1) {
      throw new FairnessQueryServiceError("Pack not found.", 404, "PACK_NOT_FOUND", { packId });
    }

    const row = packResult.rows[0];
    const cards = await listPackCards(client, row.pack_id);

    const isLegacyPack = isLegacyFairnessPack(row);

    if (isLegacyPack) {
      return {
        packId: row.pack_id,
        dropId: row.drop_id,
        tier: row.tier,
        purchasedAt: row.purchased_at,
        verificationStatus: "UNVERIFIABLE_LEGACY_PACK",
        verificationError: "UNVERIFIABLE_LEGACY_PACK",
        generationVersion: null,
        commitment: null,
        seed: null,
        cards
      };
    }

    const generationVersionId = row.generation_version_id as string;
    const serverSeedId = row.server_seed_id as string;
    const serverSeedHashAtCommit = row.server_seed_hash_at_commit as string;
    const clientSeed = row.client_seed as string;
    const nonce = row.nonce as string;
    const seedHash = row.seed_hash as string;
    const committedAt = row.committed_at as string;

    const generationVersion = await getGenerationVersionById(client, generationVersionId);
    if (!generationVersion) {
      throw new FairnessQueryServiceError(
        "Pinned generation version could not be resolved for pack.",
        500,
        "GENERATION_VERSION_MISSING",
        { packId: row.pack_id, generationVersionId }
      );
    }

    const verification = resolveFairnessVerification(row);

    return {
      packId: row.pack_id,
      dropId: row.drop_id,
      tier: row.tier,
      purchasedAt: row.purchased_at,
      verificationStatus: verification.status,
      verificationError: verification.error,
      generationVersion: toGenerationVersionView(generationVersion),
      commitment: {
        serverSeedId,
        serverSeedHashAtCommit,
        clientSeed,
        nonce,
        committedAt
      },
      seed: {
        seedHash,
        revealedAt: row.revealed_at,
        seedValue: verification.seedValue
      },
      cards
    };
  });
}

export async function listMyFairnessPacks(input: {
  userId: string;
  date?: string | null;
  dropId?: string | null;
  cursor?: string | null;
  limit?: number;
}): Promise<FairnessMyPacksResult> {
  return withTransaction(async (client) => {
    const limit = normalizeMyPacksLimit(input.limit);
    const predicates: string[] = ["p.user_id = $1"];
    const params: unknown[] = [input.userId];

    if (input.dropId) {
      params.push(input.dropId);
      predicates.push(`dp.drop_id = $${params.length}::uuid`);
    }

    if (input.date) {
      const start = parseDateOnly(input.date);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

      params.push(start.toISOString());
      const startIndex = params.length;
      params.push(end.toISOString());
      const endIndex = params.length;
      predicates.push(`d.scheduled_at >= $${startIndex}::timestamptz AND d.scheduled_at < $${endIndex}::timestamptz`);
    }

    if (input.cursor) {
      const cursor = decodeFairnessMyPacksCursor(input.cursor);
      params.push(cursor.purchasedAt);
      const purchasedAtIndex = params.length;
      params.push(cursor.packId);
      const packIdIndex = params.length;

      predicates.push(
        `(p.purchased_at < $${purchasedAtIndex}::timestamptz OR (p.purchased_at = $${purchasedAtIndex}::timestamptz AND p.id < $${packIdIndex}::uuid))`
      );
    }

    params.push(limit + 1);
    const limitIndex = params.length;
    const rows = await client.query<FairnessMyPackRow>(
      `SELECT p.id AS pack_id,
              dp.drop_id,
              d.scheduled_at AS drop_scheduled_at,
              p.tier,
              p.purchased_at,
              p.generation_version_id,
              pc.server_seed_id,
              pc.server_seed_hash_at_commit,
              pc.client_seed,
              pc.nonce::text,
              ss.seed_hash,
              ss.seed_value_ciphertext,
              ss.seed_iv,
              ss.seed_auth_tag,
              ss.committed_at,
              ss.revealed_at
       FROM packs p
       JOIN drop_packs dp ON dp.id = p.drop_pack_id
       JOIN drops d ON d.id = dp.drop_id
       LEFT JOIN pack_commitments pc ON pc.pack_id = p.id
       LEFT JOIN server_seeds ss ON ss.id = pc.server_seed_id
       WHERE ${predicates.join(" AND ")}
       ORDER BY p.purchased_at DESC, p.id DESC
       LIMIT $${limitIndex}`,
      params
    );

    const hasMore = rows.rows.length > limit;
    const visibleRows = hasMore ? rows.rows.slice(0, limit) : rows.rows;

    const packs = visibleRows.map((row) => {
      const verification = resolveFairnessVerification(row);
      return {
        id: row.pack_id,
        tier: row.tier,
        dropId: row.drop_id,
        dropScheduledAt: row.drop_scheduled_at,
        purchasedAt: row.purchased_at,
        verificationStatus: verification.status
      } satisfies FairnessMyPackSummary;
    });

    const nextCursor =
      hasMore && visibleRows.length > 0
        ? encodeFairnessMyPacksCursor({
            purchasedAt: visibleRows[visibleRows.length - 1].purchased_at,
            packId: visibleRows[visibleRows.length - 1].pack_id
          })
        : null;

    return {
      packs,
      nextCursor
    };
  });
}

export async function listAdminFairnessDropSummaries(): Promise<FairnessAdminDropSummary[]> {
  const result = await withTransaction(async (client) =>
    client.query<FairnessAdminDropSummaryRow>(
      `SELECT d.id AS drop_id,
              d.scheduled_at AS drop_scheduled_at,
              d.status AS drop_status,
              COUNT(p.id)::BIGINT AS pack_count,
              COUNT(*) FILTER (
                WHERE p.id IS NOT NULL
                  AND p.generation_version_id IS NOT NULL
                  AND pc.server_seed_id IS NOT NULL
                  AND pc.server_seed_hash_at_commit IS NOT NULL
                  AND pc.client_seed IS NOT NULL
                  AND pc.nonce IS NOT NULL
                  AND ss.seed_hash IS NOT NULL
                  AND ss.committed_at IS NOT NULL
                  AND ss.revealed_at IS NOT NULL
                  AND ss.seed_value_ciphertext IS NOT NULL
                  AND ss.seed_iv IS NOT NULL
                  AND ss.seed_auth_tag IS NOT NULL
              )::BIGINT AS verifiable_count,
              COUNT(*) FILTER (
                WHERE p.id IS NOT NULL
                  AND p.generation_version_id IS NOT NULL
                  AND pc.server_seed_id IS NOT NULL
                  AND pc.server_seed_hash_at_commit IS NOT NULL
                  AND pc.client_seed IS NOT NULL
                  AND pc.nonce IS NOT NULL
                  AND ss.seed_hash IS NOT NULL
                  AND ss.committed_at IS NOT NULL
                  AND ss.revealed_at IS NULL
              )::BIGINT AS unrevealed_count,
              COUNT(*) FILTER (
                WHERE p.id IS NOT NULL
                  AND p.generation_version_id IS NOT NULL
                  AND pc.server_seed_id IS NOT NULL
                  AND pc.server_seed_hash_at_commit IS NOT NULL
                  AND pc.client_seed IS NOT NULL
                  AND pc.nonce IS NOT NULL
                  AND ss.seed_hash IS NOT NULL
                  AND ss.committed_at IS NOT NULL
                  AND ss.revealed_at IS NOT NULL
                  AND (
                    ss.seed_value_ciphertext IS NULL
                    OR ss.seed_iv IS NULL
                    OR ss.seed_auth_tag IS NULL
                  )
              )::BIGINT AS decrypt_failed_count,
              COUNT(*) FILTER (
                WHERE p.id IS NOT NULL
                  AND (
                    p.generation_version_id IS NULL
                    OR pc.server_seed_id IS NULL
                    OR pc.server_seed_hash_at_commit IS NULL
                    OR pc.client_seed IS NULL
                    OR pc.nonce IS NULL
                    OR ss.seed_hash IS NULL
                    OR ss.committed_at IS NULL
                  )
              )::BIGINT AS legacy_count,
              (ARRAY_AGG(p.id::text ORDER BY p.purchased_at DESC, p.id DESC))[1] AS latest_pack_id
       FROM drops d
       LEFT JOIN drop_packs dp ON dp.drop_id = d.id
       LEFT JOIN packs p ON p.drop_pack_id = dp.id
       LEFT JOIN pack_commitments pc ON pc.pack_id = p.id
       LEFT JOIN server_seeds ss ON ss.id = pc.server_seed_id
       GROUP BY d.id, d.scheduled_at, d.status
       ORDER BY d.scheduled_at DESC`
    )
  );

  return result.rows.map((row) => ({
    dropId: row.drop_id,
    dropScheduledAt: row.drop_scheduled_at,
    dropStatus: row.drop_status,
    packCount: Number(row.pack_count),
    verifiableCount: Number(row.verifiable_count),
    unrevealedCount: Number(row.unrevealed_count),
    decryptFailedCount: Number(row.decrypt_failed_count),
    legacyCount: Number(row.legacy_count),
    latestPackId: row.latest_pack_id
  }));
}

function normalizePagination(input: { page?: number; limit?: number }): { page: number; limit: number; offset: number } {
  const page = Number.isFinite(input.page) ? Math.max(1, Math.trunc(input.page as number)) : 1;
  const limit = Number.isFinite(input.limit) ? Math.min(100, Math.max(1, Math.trunc(input.limit as number))) : 20;
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

export async function listFairnessSeeds(input: {
  dropId?: string | null;
  status?: FairnessSeedStatusFilter;
  page?: number;
  limit?: number;
}): Promise<FairnessSeedListResult> {
  return withTransaction(async (client) => {
    const pagination = normalizePagination({ page: input.page, limit: input.limit });
    const status = input.status ?? "all";

    const predicates: string[] = [];
    const params: unknown[] = [];

    if (input.dropId) {
      params.push(input.dropId);
      predicates.push(`ss.drop_id = $${params.length}`);
    }

    if (status === "revealed") {
      predicates.push("ss.revealed_at IS NOT NULL");
    } else if (status === "unrevealed") {
      predicates.push("ss.revealed_at IS NULL");
    }

    const whereClause = predicates.length > 0 ? `WHERE ${predicates.join(" AND ")}` : "";

    const totalResult = await client.query<CountRow>(
      `SELECT COUNT(*)::BIGINT AS count
       FROM server_seeds ss
       ${whereClause}`,
      params
    );
    const total = Number(totalResult.rows[0]?.count ?? "0");

    params.push(pagination.limit);
    params.push(pagination.offset);

    const rows = await client.query<FairnessSeedListRow>(
      `SELECT ss.id,
              ss.drop_id,
              ss.seed_hash,
              ss.committed_at,
              ss.revealed_at,
              snc.next_nonce::text,
              (ss.seed_value_ciphertext IS NOT NULL) AS has_ciphertext
       FROM server_seeds ss
       LEFT JOIN server_seed_nonce_counters snc ON snc.server_seed_id = ss.id
       ${whereClause}
       ORDER BY ss.committed_at DESC
       LIMIT $${params.length - 1}
       OFFSET $${params.length}`,
      params
    );

    return {
      seeds: rows.rows.map((row) => ({
        id: row.id,
        dropId: row.drop_id,
        seedHash: row.seed_hash,
        committedAt: row.committed_at,
        revealedAt: row.revealed_at,
        status: row.revealed_at ? "revealed" : "unrevealed",
        nextNonce: row.next_nonce,
        hasCiphertext: row.has_ciphertext
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
