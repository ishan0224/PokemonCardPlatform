import { closeDatabasePool, query, withTransaction } from "../src/server/db/pool";
import { solvePhase0BootstrapGeneration } from "../src/server/economics/phase0-bootstrap-solver";
import {
  buildAnchorSnapshotFromCatalog,
  buildEligibleIdsByTierFromCatalog,
  buildWeightsByTierFromConfig,
  ensureGenerationVersion,
  GENERATION_VERSION_ALGORITHM
} from "../src/server/services/pack-generation-version.service";

type CountRow = {
  count: string;
};

type Phase0InvariantCounts = {
  nullDropGenerationPins: number;
  nullPackGenerationVersions: number;
  completedDropsMissingServerSeed: number;
  completedDropsInvalidLegacySeedShape: number;
  completedDropsWrongLegacySeedHash: number;
};

async function loadPhase0InvariantCounts(): Promise<Phase0InvariantCounts> {
  const row = await query<{
    null_drop_generation_pins: string;
    null_pack_generation_versions: string;
    completed_drops_missing_server_seed: string;
    completed_drops_invalid_legacy_seed_shape: string;
    completed_drops_wrong_legacy_seed_hash: string;
  }>(
    `SELECT
       (SELECT COUNT(*)::BIGINT
        FROM drops
        WHERE active_generation_version_id IS NULL) AS null_drop_generation_pins,
       (SELECT COUNT(*)::BIGINT
        FROM packs
        WHERE generation_version_id IS NULL) AS null_pack_generation_versions,
       (SELECT COUNT(*)::BIGINT
        FROM drops d
        LEFT JOIN server_seeds ss ON ss.drop_id = d.id
        WHERE d.status = 'completed'
          AND ss.id IS NULL) AS completed_drops_missing_server_seed,
       (SELECT COUNT(*)::BIGINT
        FROM drops d
        JOIN server_seeds ss ON ss.drop_id = d.id
        WHERE d.status = 'completed'
          AND NOT (
            ss.revealed_at IS NOT NULL
            AND ss.seed_value_ciphertext IS NULL
            AND ss.seed_iv IS NULL
            AND ss.seed_auth_tag IS NULL
          )) AS completed_drops_invalid_legacy_seed_shape,
       (SELECT COUNT(*)::BIGINT
        FROM drops d
        JOIN server_seeds ss ON ss.drop_id = d.id
        WHERE d.status = 'completed'
          AND ss.seed_hash <> encode(digest('LEGACY_PRE_MIGRATION', 'sha256'), 'hex')
       ) AS completed_drops_wrong_legacy_seed_hash`
  );

  return {
    nullDropGenerationPins: Number(row.rows[0]?.null_drop_generation_pins ?? "0"),
    nullPackGenerationVersions: Number(row.rows[0]?.null_pack_generation_versions ?? "0"),
    completedDropsMissingServerSeed: Number(row.rows[0]?.completed_drops_missing_server_seed ?? "0"),
    completedDropsInvalidLegacySeedShape: Number(row.rows[0]?.completed_drops_invalid_legacy_seed_shape ?? "0"),
    completedDropsWrongLegacySeedHash: Number(row.rows[0]?.completed_drops_wrong_legacy_seed_hash ?? "0")
  };
}

function assertPhase0Invariants(stage: string, counts: Phase0InvariantCounts): void {
  if (
    counts.nullDropGenerationPins !== 0 ||
    counts.nullPackGenerationVersions !== 0 ||
    counts.completedDropsMissingServerSeed !== 0 ||
    counts.completedDropsInvalidLegacySeedShape !== 0 ||
    counts.completedDropsWrongLegacySeedHash !== 0
  ) {
    throw new Error(
      `[partb:phase0:backfill] ${stage} invariant failure: ` +
        `null_drop_generation_pins=${counts.nullDropGenerationPins}, ` +
        `null_pack_generation_versions=${counts.nullPackGenerationVersions}, ` +
        `completed_drops_missing_server_seed=${counts.completedDropsMissingServerSeed}, ` +
        `completed_drops_invalid_legacy_seed_shape=${counts.completedDropsInvalidLegacySeedShape}, ` +
        `completed_drops_wrong_legacy_seed_hash=${counts.completedDropsWrongLegacySeedHash}. ` +
        "Run schema+backfill diagnostics and repair before rerunning."
    );
  }
}

async function main(): Promise<void> {
  // Phase 0 Step 1-2: bootstrap solver + first generation version row.
  const bootstrap = await withTransaction(async (client) => {
    const anchorSnapshot = await buildAnchorSnapshotFromCatalog(client);
    const eligibleCardIdsByTier = await buildEligibleIdsByTierFromCatalog(client);
    const baseWeightsByTier = buildWeightsByTierFromConfig();

    const solveResult = solvePhase0BootstrapGeneration({
      anchorSnapshot,
      baseWeightsByTier
    });

    const generationVersion = await ensureGenerationVersion(client, {
      algorithmVersion: GENERATION_VERSION_ALGORITHM,
      weightsByTier: solveResult.solvedWeightsByTier,
      eligibleCardIdsByTier,
      anchorSnapshot
    });

    return {
      generationVersionId: generationVersion.id,
      diagnosticsByTier: solveResult.diagnosticsByTier
    };
  });

  // Phase 0 Step 3-5: data stamping + legacy seed markers.
  const stamped = await withTransaction(async (client) => {
    const updatedDrops = await client.query(
      `UPDATE drops
       SET active_generation_version_id = $1
       WHERE active_generation_version_id IS DISTINCT FROM $1`,
      [bootstrap.generationVersionId]
    );

    const updatedPacks = await client.query(
      `UPDATE packs
       SET generation_version_id = $1
       WHERE generation_version_id IS DISTINCT FROM $1`,
      [bootstrap.generationVersionId]
    );

    const insertedLegacySeeds = await client.query(
      `INSERT INTO server_seeds (
         drop_id,
         seed_hash,
         seed_value_ciphertext,
         seed_iv,
         seed_auth_tag,
         committed_at,
         revealed_at
       )
       SELECT d.id,
              encode(digest('LEGACY_PRE_MIGRATION', 'sha256'), 'hex'),
              NULL,
              NULL,
              NULL,
              now(),
              now()
       FROM drops d
       LEFT JOIN server_seeds ss ON ss.drop_id = d.id
       WHERE d.status = 'completed'
         AND ss.id IS NULL`
    );

    return {
      updatedDropRows: updatedDrops.rowCount ?? 0,
      updatedPackRows: updatedPacks.rowCount ?? 0,
      insertedLegacySeedRows: insertedLegacySeeds.rowCount ?? 0
    };
  });

  const invariantsAfterStamping = await loadPhase0InvariantCounts();
  assertPhase0Invariants("after stamping", invariantsAfterStamping);

  // Phase 0 Step 7 precheck before schema tightening.
  const nullGenerationPacksBefore = await query<CountRow>(
    `SELECT COUNT(*)::BIGINT AS count
     FROM packs
     WHERE generation_version_id IS NULL`
  );

  const remainingNullBefore = Number(nullGenerationPacksBefore.rows[0]?.count ?? "0");
  if (remainingNullBefore !== 0) {
    throw new Error(
      `Phase 0 backfill incomplete before NOT NULL enforcement: ${remainingNullBefore} packs still have NULL generation_version_id. Run data backfill repair before retrying SET NOT NULL.`
    );
  }

  // Phase 0 Step 7 schema hardening in isolated transaction.
  await withTransaction(async (client) => {
    await client.query("ALTER TABLE packs ALTER COLUMN generation_version_id SET NOT NULL");
  });

  const nullGenerationPacksAfter = await query<CountRow>(
    `SELECT COUNT(*)::BIGINT AS count
     FROM packs
     WHERE generation_version_id IS NULL`
  );

  const remainingNullAfter = Number(nullGenerationPacksAfter.rows[0]?.count ?? "0");
  if (remainingNullAfter !== 0) {
    throw new Error(
      `Phase 0 backfill validation failed: ${remainingNullAfter} packs still have NULL generation_version_id after NOT NULL enforcement. Investigate partial writes and rerun backfill repair.`
    );
  }

  const invariantsAfterNotNull = await loadPhase0InvariantCounts();
  assertPhase0Invariants("after NOT NULL enforcement", invariantsAfterNotNull);

  console.log("[partb:phase0:backfill] completed", {
    bootstrapGenerationVersionId: bootstrap.generationVersionId,
    diagnosticsByTier: bootstrap.diagnosticsByTier,
    ...stamped,
    nullGenerationPackCountBeforeTightening: remainingNullBefore,
    nullGenerationPackCountAfterTightening: remainingNullAfter,
    invariantsAfterStamping,
    invariantsAfterNotNull
  });
}

main()
  .catch((error) => {
    console.error("[partb:phase0:backfill] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabasePool();
  });
