import { spawnSync } from "child_process";
import { randomUUID } from "crypto";
import { Pool } from "pg";

type IsolationMode = "database" | "schema";

type IsolationTarget = {
  mode: IsolationMode;
  databaseUrl: string;
  adminDatabaseUrl: string;
  databaseName?: string;
  schemaName?: string;
};

type InvariantCounts = {
  nullDropGenerationPins: number;
  nullPackGenerationVersions: number;
  completedDropsMissingServerSeed: number;
  completedDropsInvalidLegacySeedShape: number;
  completedDropsWrongLegacySeedHash: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for Phase 0 cold-bootstrap QA.");
  }
  return databaseUrl;
}

function isSslEnabled(): boolean {
  return process.env.DATABASE_SSL === "true";
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

function baseConnectionOptions(): { ssl?: { rejectUnauthorized: false } } {
  if (!isSslEnabled()) {
    return {};
  }
  return { ssl: { rejectUnauthorized: false } };
}

function withDatabase(url: URL, databaseName: string): URL {
  const clone = new URL(url.toString());
  clone.pathname = `/${databaseName}`;
  return clone;
}

function withSearchPathOption(url: URL, schemaName: string): URL {
  const clone = new URL(url.toString());
  const searchPathOption = `-c search_path=${schemaName},public`;
  const existingOptions = clone.searchParams.get("options");
  if (existingOptions) {
    clone.searchParams.set("options", `${existingOptions} ${searchPathOption}`);
  } else {
    clone.searchParams.set("options", searchPathOption);
  }
  return clone;
}

function runCommand(label: string, command: string, args: string[], env: NodeJS.ProcessEnv): string {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    env,
    encoding: "utf8"
  });
  const durationMs = Date.now() - startedAt;

  if (result.status !== 0) {
    const stdout = result.stdout?.trim() ?? "";
    const stderr = result.stderr?.trim() ?? "";
    throw new Error(
      `[phase0:cold-bootstrap] ${label} failed in ${durationMs}ms.\n` +
        `Command: ${command} ${args.join(" ")}\n` +
        `stdout:\n${stdout}\n` +
        `stderr:\n${stderr}`
    );
  }

  console.log(`[phase0:cold-bootstrap] ${label} ok (${durationMs}ms)`);
  return result.stdout ?? "";
}

function runPsqlFile(filePath: string, env: NodeJS.ProcessEnv): void {
  runCommand(`psql -f ${filePath}`, "psql", [env.DATABASE_URL ?? "", "-v", "ON_ERROR_STOP=1", "-f", filePath], env);
}

function runNpmScript(scriptName: string, env: NodeJS.ProcessEnv): string {
  return runCommand(`npm run ${scriptName}`, "npm", ["run", scriptName], env);
}

async function chooseIsolationTarget(baseDatabaseUrl: string, forceSchemaFallback: boolean): Promise<IsolationTarget> {
  const baseUrl = new URL(baseDatabaseUrl);
  const adminDatabaseName = process.env.PHASE0_COLD_BOOTSTRAP_ADMIN_DB ?? "postgres";
  const adminUrl = withDatabase(baseUrl, adminDatabaseName);

  const randomSuffix = randomUUID().replace(/-/g, "").slice(0, 12);
  const isolatedDatabaseName = `pv_phase0_qa_${randomSuffix}`;
  const isolatedSchemaName = `pv_phase0_qa_${randomSuffix}`;

  if (!forceSchemaFallback) {
    const adminPool = new Pool({
      connectionString: adminUrl.toString(),
      ...baseConnectionOptions()
    });

    try {
      await adminPool.query(`CREATE DATABASE ${quoteIdent(isolatedDatabaseName)}`);
      return {
        mode: "database",
        databaseName: isolatedDatabaseName,
        databaseUrl: withDatabase(baseUrl, isolatedDatabaseName).toString(),
        adminDatabaseUrl: adminUrl.toString()
      };
    } catch (error) {
      console.warn("[phase0:cold-bootstrap] create database failed; falling back to isolated schema mode.", error);
    } finally {
      await adminPool.end();
    }
  } else {
    console.log("[phase0:cold-bootstrap] forced schema fallback mode enabled.");
  }

  const basePool = new Pool({
    connectionString: baseUrl.toString(),
    ...baseConnectionOptions()
  });

  try {
    await basePool.query(`CREATE SCHEMA ${quoteIdent(isolatedSchemaName)}`);
  } finally {
    await basePool.end();
  }

  return {
    mode: "schema",
    schemaName: isolatedSchemaName,
    databaseUrl: withSearchPathOption(baseUrl, isolatedSchemaName).toString(),
    adminDatabaseUrl: adminUrl.toString()
  };
}

async function cleanupIsolationTarget(target: IsolationTarget): Promise<void> {
  if (target.mode === "database" && target.databaseName) {
    const adminPool = new Pool({
      connectionString: target.adminDatabaseUrl,
      ...baseConnectionOptions()
    });

    try {
      let dropped = false;
      const maxAttempts = 5;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        await adminPool.query(
          `SELECT pg_terminate_backend(pid)
           FROM pg_stat_activity
           WHERE datname = $1
             AND pid <> pg_backend_pid()`,
          [target.databaseName]
        );

        try {
          await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdent(target.databaseName)}`);
          dropped = true;
          break;
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (code !== "55006" || attempt === maxAttempts) {
            throw error;
          }
          await sleep(300);
        }
      }

      if (!dropped) {
        throw new Error(`[phase0:cold-bootstrap] failed to drop isolated database ${target.databaseName}.`);
      }
    } finally {
      await adminPool.end();
    }
    return;
  }

  if (target.mode === "schema" && target.schemaName) {
    const basePool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ...baseConnectionOptions()
    });
    try {
      await basePool.query(`DROP SCHEMA IF EXISTS ${quoteIdent(target.schemaName)} CASCADE`);
    } finally {
      await basePool.end();
    }
  }
}

async function loadInvariantCounts(pool: Pool): Promise<InvariantCounts> {
  const row = await pool.query<{
    null_drop_generation_pins: string;
    null_pack_generation_versions: string;
    completed_drops_missing_server_seed: string;
    completed_drops_invalid_legacy_seed_shape: string;
    completed_drops_wrong_legacy_seed_hash: string;
  }>(
    `SELECT
       (SELECT COUNT(*)::BIGINT FROM drops WHERE active_generation_version_id IS NULL) AS null_drop_generation_pins,
       (SELECT COUNT(*)::BIGINT FROM packs WHERE generation_version_id IS NULL) AS null_pack_generation_versions,
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

function assertInvariantCounts(stage: string, counts: InvariantCounts): void {
  if (
    counts.nullDropGenerationPins !== 0 ||
    counts.nullPackGenerationVersions !== 0 ||
    counts.completedDropsMissingServerSeed !== 0 ||
    counts.completedDropsInvalidLegacySeedShape !== 0 ||
    counts.completedDropsWrongLegacySeedHash !== 0
  ) {
    throw new Error(
      `[phase0:cold-bootstrap] ${stage} invariant failure: ` +
        `null_drop_generation_pins=${counts.nullDropGenerationPins}, ` +
        `null_pack_generation_versions=${counts.nullPackGenerationVersions}, ` +
        `completed_drops_missing_server_seed=${counts.completedDropsMissingServerSeed}, ` +
        `completed_drops_invalid_legacy_seed_shape=${counts.completedDropsInvalidLegacySeedShape}, ` +
        `completed_drops_wrong_legacy_seed_hash=${counts.completedDropsWrongLegacySeedHash}`
    );
  }
}

async function assertPhase0SchemaObjects(pool: Pool): Promise<void> {
  const requiredTables = [
    "pack_generation_versions",
    "server_seeds",
    "server_seed_nonce_counters",
    "pack_commitments",
    "auction_flags",
    "security_events",
    "fairness_audit_results"
  ];

  for (const table of requiredTables) {
    const result = await pool.query<{ exists: boolean }>(`SELECT to_regclass($1) IS NOT NULL AS exists`, [table]);
    if (!result.rows[0]?.exists) {
      throw new Error(`[phase0:cold-bootstrap] missing required table: ${table}`);
    }
  }

  const dropsColumn = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_name = 'drops'
         AND column_name = 'active_generation_version_id'
     ) AS exists`
  );
  if (!dropsColumn.rows[0]?.exists) {
    throw new Error("[phase0:cold-bootstrap] drops.active_generation_version_id column missing.");
  }

  const packsColumn = await pool.query<{ is_nullable: "YES" | "NO" }>(
    `SELECT is_nullable
     FROM information_schema.columns
     WHERE table_name = 'packs'
       AND column_name = 'generation_version_id'`
  );
  if (packsColumn.rowCount !== 1) {
    throw new Error("[phase0:cold-bootstrap] packs.generation_version_id column missing.");
  }
}

async function getLatestDropId(pool: Pool): Promise<string | null> {
  const latest = await pool.query<{ id: string }>(
    `SELECT id
     FROM drops
     ORDER BY created_at DESC
     LIMIT 1`
  );
  return latest.rows[0]?.id ?? null;
}

async function assertPinnedDropWithThreePackRows(pool: Pool, dropId: string, label: string): Promise<void> {
  const drop = await pool.query<{ active_generation_version_id: string | null }>(
    `SELECT active_generation_version_id
     FROM drops
     WHERE id = $1`,
    [dropId]
  );
  if (drop.rowCount !== 1 || !drop.rows[0].active_generation_version_id) {
    throw new Error(`[phase0:cold-bootstrap] ${label} drop ${dropId} is missing active_generation_version_id.`);
  }

  const packsByTier = await pool.query<{ tier: string; count: string }>(
    `SELECT tier, COUNT(*)::BIGINT AS count
     FROM drop_packs
     WHERE drop_id = $1
     GROUP BY tier
     ORDER BY tier ASC`,
    [dropId]
  );

  const expected = new Map<string, number>([
    ["elite", 1],
    ["premium", 1],
    ["standard", 1]
  ]);
  if (packsByTier.rowCount !== 3) {
    throw new Error(`[phase0:cold-bootstrap] ${label} drop ${dropId} must have exactly 3 tier rows.`);
  }
  for (const row of packsByTier.rows) {
    const count = Number(row.count);
    const expectedCount = expected.get(row.tier);
    if (expectedCount !== 1 || count !== 1) {
      throw new Error(`[phase0:cold-bootstrap] ${label} drop ${dropId} has invalid tier distribution.`);
    }
  }
}

async function main(): Promise<void> {
  const keepDb = process.argv.includes("--keep-db");
  const forceSchemaFallback = process.argv.includes("--force-schema-fallback");
  const baseDatabaseUrl = requireDatabaseUrl();

  const target = await chooseIsolationTarget(baseDatabaseUrl, forceSchemaFallback);
  const isolatedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: target.databaseUrl
  };

  console.log("[phase0:cold-bootstrap] target", {
    mode: target.mode,
    databaseName: target.databaseName,
    schemaName: target.schemaName
  });

  const schemaPath = "src/server/db/schema.sql";
  const seedSqlPath = "src/server/db/seed.sql";

  try {
    runPsqlFile(schemaPath, isolatedEnv);
    runNpmScript("partb:phase0:backfill", isolatedEnv);

    const isolatedPool = new Pool({
      connectionString: target.databaseUrl,
      ...baseConnectionOptions()
    });

    try {
      await assertPhase0SchemaObjects(isolatedPool);

      const latestBeforeSeedSql = await getLatestDropId(isolatedPool);
      runPsqlFile(seedSqlPath, isolatedEnv);
      const latestAfterSeedSql = await getLatestDropId(isolatedPool);
      if (!latestAfterSeedSql || latestAfterSeedSql === latestBeforeSeedSql) {
        throw new Error("[phase0:cold-bootstrap] seed.sql did not create a new drop.");
      }
      await assertPinnedDropWithThreePackRows(isolatedPool, latestAfterSeedSql, "seed.sql");

      const latestBeforeSeedDropScript = latestAfterSeedSql;
      runNpmScript("seed:drop", isolatedEnv);
      const latestAfterSeedDropScript = await getLatestDropId(isolatedPool);
      if (!latestAfterSeedDropScript || latestAfterSeedDropScript === latestBeforeSeedDropScript) {
        throw new Error("[phase0:cold-bootstrap] seed:drop did not create a new drop.");
      }
      await assertPinnedDropWithThreePackRows(isolatedPool, latestAfterSeedDropScript, "seed:drop");

      runNpmScript("partb:phase0:backfill", isolatedEnv);

      const finalCounts = await loadInvariantCounts(isolatedPool);
      assertInvariantCounts("final", finalCounts);

      const nullability = await isolatedPool.query<{ is_nullable: "YES" | "NO" }>(
        `SELECT is_nullable
         FROM information_schema.columns
         WHERE table_name = 'packs'
           AND column_name = 'generation_version_id'`
      );
      if (nullability.rows[0]?.is_nullable !== "NO") {
        throw new Error("[phase0:cold-bootstrap] packs.generation_version_id is not NOT NULL after backfill.");
      }

      console.log("[phase0:cold-bootstrap] completed", {
        mode: target.mode,
        finalCounts
      });
    } finally {
      await isolatedPool.end();
    }
  } finally {
    if (keepDb) {
      console.log("[phase0:cold-bootstrap] keep-db enabled; skipping cleanup.", {
        mode: target.mode,
        databaseName: target.databaseName,
        schemaName: target.schemaName
      });
    } else {
      await cleanupIsolationTarget(target);
      console.log("[phase0:cold-bootstrap] cleaned up isolated target.");
    }
  }
}

main().catch((error) => {
  console.error("[phase0:cold-bootstrap] failed", error);
  process.exitCode = 1;
});
