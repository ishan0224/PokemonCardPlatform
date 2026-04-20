import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { PACK_PRICE_CENTS } from "../src/server/config/constants";
import { closeDatabasePool, pingDatabase, query, withTransaction } from "../src/server/db/pool";
import { closeRedisClients, pingRedis } from "../src/server/redis/client";
import {
  createAuctionFlag,
  listAuctionFlags,
  resolveAuctionFlag
} from "../src/server/services/auction-flag.service";
import {
  getLatestFairnessAuditResult,
  getLatestNightlyFairnessAuditResult
} from "../src/server/services/fairness-audit.service";
import { getPackEconomicsBundle } from "../src/server/services/economics.service";
import { ensureLatestGenerationVersion } from "../src/server/services/pack-generation-version.service";

type RuntimeStatus = "PASS" | "FAIL" | "BLOCKED_ENV";

type RuntimeReport = {
  runId: string;
  mode: "lite" | "full";
  status: RuntimeStatus;
  generatedAtIso: string;
  checks: Record<string, boolean>;
  blockedReason: string | null;
  failureReason: string | null;
};

type FixtureState = {
  userId: string;
  dropId: string;
  dropPackId: string;
  packId: string;
  generationVersionId: string;
  pokemonCardId: string;
  cardId: string;
  auctionId: string;
  fairnessRowIds: string[];
  flagId: string | null;
};

const MODE = process.env.PARTB_PHASE6_RUNTIME_MODE === "full" ? "full" : "lite";
const WATCHER_SAMPLE_COUNT = MODE === "full" ? 12 : 3;

function envMissing(keys: string[]): string[] {
  return keys.filter((key) => !process.env[key] || process.env[key]?.trim().length === 0);
}

function isConnectivityError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const typed = error as { code?: string; message?: string };
  const code = typed.code ?? "";
  if (
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ENETUNREACH"
  ) {
    return true;
  }

  const message = (typed.message ?? "").toLowerCase();
  return (
    message.includes("enotfound") ||
    message.includes("eai_again") ||
    message.includes("connect econnrefused") ||
    message.includes("timed out") ||
    message.includes("network")
  );
}

async function cleanupLegacyPhase6FixtureGenerationVersions(): Promise<void> {
  const legacyResult = await query<{ id: string }>(
    `SELECT id
     FROM pack_generation_versions
     WHERE algorithm_version = 'phase6-runtime-fixture-v1'`
  );

  if (legacyResult.rowCount === 0) {
    return;
  }

  const canonicalResult = await query<{ id: string }>(
    `SELECT id
     FROM pack_generation_versions
     WHERE algorithm_version = 'pack-gen-v2-deterministic'
     ORDER BY version_number DESC
     LIMIT 1`
  );

  if (canonicalResult.rowCount !== 1) {
    console.warn(
      "[test:partb:phase6:runtime] legacy generation versions detected, but no canonical generation version exists; skipping auto-clean."
    );
    return;
  }

  const legacyIds = legacyResult.rows.map((row) => row.id);
  const canonicalId = canonicalResult.rows[0].id;

  await query(
    `UPDATE drops
     SET active_generation_version_id = $1
     WHERE active_generation_version_id = ANY($2::uuid[])`,
    [canonicalId, legacyIds]
  );

  await query(
    `UPDATE packs
     SET generation_version_id = $1
     WHERE generation_version_id = ANY($2::uuid[])`,
    [canonicalId, legacyIds]
  );

  await query(
    `DELETE FROM pack_generation_versions
     WHERE id = ANY($1::uuid[])`,
    [legacyIds]
  );

  console.log(
    `[test:partb:phase6:runtime] cleaned ${legacyIds.length} legacy phase6 fixture generation version row(s).`
  );
}

async function checkTableExists(tableName: string): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [tableName]
  );
  return result.rows[0]?.exists === true;
}

function buildRarityCounts(value: number): Record<string, number> {
  return {
    common: value,
    uncommon: value,
    rare: value,
    holo_rare: value,
    ultra_rare: value,
    chase: value
  };
}

async function seedFixtures(runId: string): Promise<FixtureState> {
  const state: FixtureState = {
    userId: randomUUID(),
    dropId: randomUUID(),
    dropPackId: randomUUID(),
    packId: randomUUID(),
    generationVersionId: "",
    pokemonCardId: randomUUID(),
    cardId: randomUUID(),
    auctionId: randomUUID(),
    fairnessRowIds: [],
    flagId: null
  };

  const username = `p6rt_${runId.slice(0, 8)}`.slice(0, 32);
  const email = `${username}@qa.local`;
  const now = new Date();
  const endsAt = new Date(now.getTime() + 60 * 60 * 1000);
  const generationVersion = await withTransaction(async (client) => ensureLatestGenerationVersion(client));
  state.generationVersionId = generationVersion.id;

  await query(
    `INSERT INTO users (id, username, email, balance, role)
     VALUES ($1, $2, $3, $4, 'admin')`,
    [state.userId, username, email, 1_000_000]
  );

  await query(
    `INSERT INTO drops (id, scheduled_at, status, active_generation_version_id)
     VALUES ($1, $2, 'active', $3)`,
    [state.dropId, now.toISOString(), state.generationVersionId]
  );

  await query(
    `INSERT INTO drop_packs (id, drop_id, tier, price, total_inventory, remaining_inventory, status)
     VALUES ($1, $2, 'standard', $3, 10, 9, 'active')`,
    [state.dropPackId, state.dropId, PACK_PRICE_CENTS.standard]
  );

  await query(
    `INSERT INTO packs (id, user_id, drop_pack_id, tier, price_paid, generation_version_id, opened, purchased_at)
     VALUES ($1, $2, $3, 'standard', $4, $5, true, now())`,
    [state.packId, state.userId, state.dropPackId, PACK_PRICE_CENTS.standard, state.generationVersionId]
  );

  await query(
    `INSERT INTO pokemon_cards (
       id, tcg_id, name, set_name, set_id, rarity, rarity_tier, current_price, previous_price
     )
     VALUES ($1, $2, 'Phase6 Runtime Card', 'Phase6 Runtime Set', 'phase6-runtime-set', 'rare', 'rare', 1000, 1000)`,
    [state.pokemonCardId, `phase6-runtime-${runId}`]
  );

  await query(
    `INSERT INTO cards (id, pack_id, owner_id, pokemon_card_id, slot_number, rarity_tier, state, acquisition_price)
     VALUES ($1, $2, $3, $4, 1, 'rare', 'owned', 1000)`,
    [state.cardId, state.packId, state.userId, state.pokemonCardId]
  );

  await query(
    `INSERT INTO auctions (
       id, card_id, seller_id, starting_bid, current_bid, current_bidder_id,
       ends_at, original_end_time, duration_type, status, created_at
     )
     VALUES ($1, $2, $3, 100, NULL, NULL, $4, $4, '1h', 'active', $5)`,
    [state.auctionId, state.cardId, state.userId, endsAt.toISOString(), now.toISOString()]
  );

  return state;
}

async function cleanupFixtures(state: FixtureState): Promise<void> {
  try {
    if (state.fairnessRowIds.length > 0) {
      await query(`DELETE FROM fairness_audit_results WHERE id = ANY($1::uuid[])`, [state.fairnessRowIds]);
    }

    if (state.flagId) {
      await query(`DELETE FROM auction_flags WHERE id = $1`, [state.flagId]);
    }

    await query(`DELETE FROM auction_watcher_samples WHERE auction_id = $1`, [state.auctionId]);
    await query(`DELETE FROM auction_flags WHERE auction_id = $1`, [state.auctionId]);
    await query(`DELETE FROM auctions WHERE id = $1`, [state.auctionId]);
    await query(`DELETE FROM cards WHERE id = $1`, [state.cardId]);
    await query(`DELETE FROM pokemon_cards WHERE id = $1`, [state.pokemonCardId]);
    await query(`DELETE FROM packs WHERE id = $1`, [state.packId]);
    await query(`DELETE FROM drop_packs WHERE id = $1`, [state.dropPackId]);
    await query(`DELETE FROM drops WHERE id = $1`, [state.dropId]);
    await query(`DELETE FROM users WHERE id = $1`, [state.userId]);
  } catch (error) {
    const typed = error as { message?: string };
    console.warn(`[test:partb:phase6:runtime] cleanup warning: ${typed.message ?? "unknown error"}`);
  }
}

async function runChecks(state: FixtureState, checks: Record<string, boolean>): Promise<void> {
  const now = new Date();

  for (let index = 0; index < WATCHER_SAMPLE_COUNT; index += 1) {
    await query(
      `INSERT INTO auction_watcher_samples (auction_id, observed_count, sampled_at)
       VALUES ($1, $2, now() - ($3::int || ' seconds')::interval)`,
      [state.auctionId, 5 + index, index]
    );
  }

  const economicsBundle = await getPackEconomicsBundle({
    from: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    to: new Date(now.getTime() + 60_000)
  });

  checks.watcher_count_avg_populated = economicsBundle.userHealth.auctionParticipation.watcherCountAvg !== null;
  checks.watcher_count_metric_source = economicsBundle.userHealth.auctionParticipation.watcherCountMetricSource === "auction_watcher_samples";
  assert.equal(checks.watcher_count_avg_populated, true, "watcher_count_avg should be populated.");
  assert.equal(
    checks.watcher_count_metric_source,
    true,
    "watcher_count_metric_source should be auction_watcher_samples."
  );

  const createdFlag = await createAuctionFlag({
    auctionId: state.auctionId,
    flagType: "phase6_runtime_flag",
    evidence: { run: "phase6-runtime", mode: MODE }
  });
  state.flagId = createdFlag.id;

  const openFlags = await listAuctionFlags({ status: "open", limit: 200 });
  checks.auction_flag_open_list_flow = openFlags.some((flag) => flag.id === state.flagId);
  assert.equal(checks.auction_flag_open_list_flow, true, "open flag should be present in open list.");

  await resolveAuctionFlag({
    flagId: state.flagId,
    adminUserId: state.userId,
    resolution: "dismissed"
  });

  const resolvedFlags = await listAuctionFlags({ status: "resolved", limit: 200 });
  checks.auction_flag_resolve_list_flow = resolvedFlags.some(
    (flag) => flag.id === state.flagId && flag.resolution === "dismissed"
  );
  assert.equal(checks.auction_flag_resolve_list_flow, true, "resolved flag should be present in resolved list.");

  const windowEnd = new Date(now.getTime() - 5 * 60 * 1000);
  const windowStart = new Date(windowEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
  const rowNightlyId = randomUUID();
  const rowOnDemandId = randomUUID();
  state.fairnessRowIds.push(rowNightlyId, rowOnDemandId);

  await query(
    `INSERT INTO fairness_audit_results (
       id, window_start, window_end, observed_counts_json, expected_counts_json,
       test_statistic, degrees_of_freedom, p_value, monte_carlo_n_samples, monte_carlo_extreme_count, run_source, ran_at
     )
     VALUES
       ($1, $3, $4, $5::jsonb, $6::jsonb, 1.0, 5, 0.5, 100000, 50000, 'nightly', $7),
       ($2, $3, $4, $5::jsonb, $6::jsonb, 1.2, 5, 0.4, 10000, 4000, 'on_demand', $8)`,
    [
      rowNightlyId,
      rowOnDemandId,
      windowStart.toISOString(),
      windowEnd.toISOString(),
      JSON.stringify(buildRarityCounts(10)),
      JSON.stringify(buildRarityCounts(10)),
      new Date(windowEnd.getTime() + 60_000).toISOString(),
      new Date(windowEnd.getTime() + 120_000).toISOString()
    ]
  );

  const latest = await getLatestFairnessAuditResult(7);
  const latestNightly = await getLatestNightlyFairnessAuditResult(7);

  checks.fairness_get_latest_row_contract = latest?.id === rowOnDemandId;
  checks.fairness_latest_nightly_helper = latestNightly?.id === rowNightlyId;
  assert.equal(checks.fairness_get_latest_row_contract, true, "GET fairness contract should return latest row.");
  assert.equal(checks.fairness_latest_nightly_helper, true, "Nightly helper should return latest nightly row.");
}

async function main(): Promise<void> {
  const runId = randomUUID();
  const reportPath = `/tmp/partb-phase6-runtime-report-${runId}.json`;
  const checks: Record<string, boolean> = {
    preflight_db_ok: false,
    preflight_redis_ok: false,
    watcher_count_avg_populated: false,
    watcher_count_metric_source: false,
    auction_flag_open_list_flow: false,
    auction_flag_resolve_list_flow: false,
    fairness_get_latest_row_contract: false,
    fairness_latest_nightly_helper: false
  };

  let status: RuntimeStatus = "FAIL";
  let blockedReason: string | null = null;
  let failureReason: string | null = null;
  let fixtures: FixtureState | null = null;

  try {
    const missing = envMissing(["DATABASE_URL", "REDIS_URL"]);
    if (missing.length > 0) {
      status = "BLOCKED_ENV";
      blockedReason = `Missing required env vars: ${missing.join(", ")}`;
      return;
    }

    try {
      checks.preflight_db_ok = await pingDatabase();
      await pingRedis();
      checks.preflight_redis_ok = true;
    } catch (error) {
      if (isConnectivityError(error)) {
        status = "BLOCKED_ENV";
        blockedReason = error instanceof Error ? error.message : "Preflight connectivity failed.";
        return;
      }
      throw error;
    }

    await cleanupLegacyPhase6FixtureGenerationVersions();

    const hasWatcherSamplesTable = await checkTableExists("public.auction_watcher_samples");
    if (!hasWatcherSamplesTable) {
      status = "BLOCKED_ENV";
      blockedReason =
        "Phase 6 schema not fully applied: required table public.auction_watcher_samples is missing. " +
        "Apply latest schema/backfill before running phase6 runtime QA.";
      return;
    }

    fixtures = await seedFixtures(runId);
    await runChecks(fixtures, checks);
    status = "PASS";
  } catch (error) {
    if (status !== "BLOCKED_ENV" && isConnectivityError(error)) {
      status = "BLOCKED_ENV";
      blockedReason = error instanceof Error ? error.message : "Runtime connectivity failure.";
    } else {
      status = "FAIL";
      failureReason = error instanceof Error ? error.message : String(error);
    }
  } finally {
    if (fixtures) {
      await cleanupFixtures(fixtures);
    }

    await Promise.allSettled([closeRedisClients(), closeDatabasePool()]);

    const report: RuntimeReport = {
      runId,
      mode: MODE,
      status,
      generatedAtIso: new Date().toISOString(),
      checks,
      blockedReason,
      failureReason
    };

    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    if (status === "PASS") {
      console.log(`[test:partb:phase6:runtime] PASS report=${reportPath}`);
      return;
    }

    if (status === "BLOCKED_ENV") {
      console.log(
        `[test:partb:phase6:runtime] BLOCKED_ENV report=${reportPath} reason=${blockedReason ?? "unknown"}`
      );
      process.exitCode = 2;
      return;
    }

    console.error(`[test:partb:phase6:runtime] FAIL report=${reportPath} reason=${failureReason ?? "unknown"}`);
    process.exitCode = 1;
  }
}

void main();
