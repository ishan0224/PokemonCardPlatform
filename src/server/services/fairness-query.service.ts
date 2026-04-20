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

type FairnessPackCardRow = {
  slot_number: number;
  rarity_tier: RarityTier;
  pokemon_card_id: string;
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

export type FairnessVerificationStatus =
  | "VERIFIABLE"
  | "SEED_UNREVEALED"
  | "SEED_DECRYPTION_FAILED"
  | "UNVERIFIABLE_LEGACY_PACK";

export type FairnessPackCard = {
  slotNumber: number;
  rarityTier: RarityTier;
  pokemonCardId: string;
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

async function listPackCards(client: Queryable, packId: string): Promise<FairnessPackCard[]> {
  const cards = await client.query<FairnessPackCardRow>(
    `SELECT slot_number, rarity_tier, pokemon_card_id
     FROM cards
     WHERE pack_id = $1
     ORDER BY slot_number ASC`,
    [packId]
  );

  return cards.rows.map((row) => ({
    slotNumber: row.slot_number,
    rarityTier: row.rarity_tier,
    pokemonCardId: row.pokemon_card_id
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

    const isLegacyPack =
      !row.generation_version_id ||
      !row.server_seed_id ||
      !row.server_seed_hash_at_commit ||
      !row.client_seed ||
      !row.nonce ||
      !row.seed_hash ||
      !row.committed_at;

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

    let verificationStatus: FairnessVerificationStatus = row.revealed_at ? "VERIFIABLE" : "SEED_UNREVEALED";
    let verificationError: string | null = null;
    let seedValue: string | null = null;

    if (row.revealed_at) {
      try {
        if (!row.seed_value_ciphertext || !row.seed_iv || !row.seed_auth_tag || !row.seed_hash) {
          throw new Error("Seed encryption columns are missing.");
        }

        seedValue = decryptServerSeed({
          seedValueCiphertext: row.seed_value_ciphertext,
          seedIv: row.seed_iv,
          seedAuthTag: row.seed_auth_tag,
          seedHash
        });
      } catch (error) {
        verificationStatus = "SEED_DECRYPTION_FAILED";
        verificationError = error instanceof Error ? error.message : "Seed decryption failed.";
      }
    }

    return {
      packId: row.pack_id,
      dropId: row.drop_id,
      tier: row.tier,
      purchasedAt: row.purchased_at,
      verificationStatus,
      verificationError,
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
        seedValue
      },
      cards
    };
  });
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
