import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { closeDatabasePool, pingDatabase, query } from "../src/server/db/pool";
import { closeRedisClients, pingRedis } from "../src/server/redis/client";
import {
  AdminDropServiceError,
  createAdminDropDraft,
  getAdminDropById,
  previewAdminDropComposition,
  publishAdminDrop,
  type AdminDropMutationInput
} from "../src/server/services/admin-drop.service";
import { searchAdminCards } from "../src/server/services/admin-card-catalog.service";
import { listDrops } from "../src/server/services/drop.service";
import { PACK_TIER_CONFIGS, PACK_TIERS } from "../src/server/config/pack-tiers";
import type { PackTier, RarityTier } from "../src/lib/types";

type RuntimeStatus = "PASS" | "FAIL" | "BLOCKED_ENV";

type RuntimeReport = {
  runId: string;
  mode: "lite";
  status: RuntimeStatus;
  generatedAtIso: string;
  checks: Record<string, boolean>;
  blockedReason: string | null;
  failureReason: string | null;
};

type FixtureState = {
  runId: string;
  setId: string;
  adminUserId: string;
  cardIds: string[];
  createdDropIds: string[];
};

const REQUIRED_RARITIES: RarityTier[] = ["common", "uncommon", "rare", "ultra_rare"];
const NON_REQUIRED_RARITIES: RarityTier[] = ["holo_rare", "chase"];
const CARDS_PER_REQUIRED_RARITY = 6;
const CARDS_PER_NON_REQUIRED_RARITY = 2;

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

function buildTierInputs(
  overrides: Partial<Record<PackTier, { includedRarities: RarityTier[] }>> = {}
): AdminDropMutationInput["tiers"] {
  return PACK_TIERS.map((tier) => ({
    tier,
    price: PACK_TIER_CONFIGS[tier].priceCents,
    totalInventory: 4,
    composition: {
      setKeys: [],
      includedRarities: overrides[tier]?.includedRarities ?? [
        ...REQUIRED_RARITIES,
        ...NON_REQUIRED_RARITIES
      ],
      explicitIncludeCardIds: [],
      explicitExcludeCardIds: []
    }
  }));
}

function buildInput(
  name: string,
  scheduledAtIsoInput?: string,
  tierOverrides?: Partial<Record<PackTier, { includedRarities: RarityTier[] }>>
): AdminDropMutationInput {
  return {
    name,
    scheduledAt: scheduledAtIsoInput ?? new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    lotteryEnabled: false,
    maxPacksPerUser: 2,
    tiers: buildTierInputs(tierOverrides)
  };
}

async function seedFixtures(runId: string): Promise<FixtureState> {
  const shortId = runId.slice(0, 8);
  const state: FixtureState = {
    runId,
    setId: `phase7-runtime-${shortId}`,
    adminUserId: randomUUID(),
    cardIds: [],
    createdDropIds: []
  };

  const username = `p7rt_${shortId}`.slice(0, 32);
  const email = `${username}@qa.local`;

  await query(
    `INSERT INTO users (id, username, email, balance, role)
     VALUES ($1, $2, $3, $4, 'admin')`,
    [state.adminUserId, username, email, 0]
  );

  const rarityPlan: Array<{ rarity: RarityTier; count: number }> = [
    ...REQUIRED_RARITIES.map((rarity) => ({ rarity, count: CARDS_PER_REQUIRED_RARITY })),
    ...NON_REQUIRED_RARITIES.map((rarity) => ({ rarity, count: CARDS_PER_NON_REQUIRED_RARITY }))
  ];

  let cardIndex = 0;
  for (const { rarity, count } of rarityPlan) {
    for (let i = 0; i < count; i += 1) {
      const id = randomUUID();
      const tcgId = `phase7-runtime-${shortId}-${rarity}-${i}`;
      await query(
        `INSERT INTO pokemon_cards (
           id, tcg_id, name, set_name, set_id, rarity, rarity_tier,
           current_price, previous_price
         )
         VALUES ($1, $2, $3, 'Phase7 Runtime Set', $4, $5, $5, 1000, 1000)`,
        [id, tcgId, `Phase7 Runtime Card ${cardIndex}`, state.setId, rarity]
      );
      state.cardIds.push(id);
      cardIndex += 1;
    }
  }

  return state;
}

async function cleanupFixtures(state: FixtureState): Promise<void> {
  try {
    if (state.createdDropIds.length > 0) {
      await query(`DELETE FROM drop_tier_compositions WHERE drop_id = ANY($1::uuid[])`, [state.createdDropIds]);
      await query(`DELETE FROM drop_packs WHERE drop_id = ANY($1::uuid[])`, [state.createdDropIds]);
      await query(`DELETE FROM drops WHERE id = ANY($1::uuid[])`, [state.createdDropIds]);
    }

    if (state.cardIds.length > 0) {
      await query(`DELETE FROM pokemon_cards WHERE id = ANY($1::uuid[])`, [state.cardIds]);
    }

    await query(`DELETE FROM users WHERE id = $1`, [state.adminUserId]);
  } catch (error) {
    const typed = error as { message?: string };
    console.warn(`[test:partb:phase7:runtime] cleanup warning: ${typed.message ?? "unknown error"}`);
  }
}

async function fetchDropRow(dropId: string): Promise<{
  id: string;
  status: string;
  active_generation_version_id: string | null;
  published_at: string | null;
} | null> {
  const result = await query<{
    id: string;
    status: string;
    active_generation_version_id: string | null;
    published_at: string | null;
  }>(
    `SELECT id, status, active_generation_version_id, published_at
     FROM drops
     WHERE id = $1`,
    [dropId]
  );

  return result.rows[0] ?? null;
}

async function fetchGenerationVersion(generationVersionId: string): Promise<{ id: string; content_hash: string } | null> {
  const result = await query<{ id: string; content_hash: string }>(
    `SELECT id, content_hash
     FROM pack_generation_versions
     WHERE id = $1`,
    [generationVersionId]
  );

  return result.rows[0] ?? null;
}

async function fetchCompositionCount(dropId: string): Promise<number> {
  const result = await query<{ n: string }>(
    `SELECT COUNT(*)::BIGINT AS n FROM drop_tier_compositions WHERE drop_id = $1`,
    [dropId]
  );

  return Number(result.rows[0]?.n ?? 0);
}

async function runChecks(state: FixtureState, checks: Record<string, boolean>): Promise<void> {
  // --------------------------------------------------------------------------
  // Preview: well-formed composition is ready.
  // --------------------------------------------------------------------------
  const previewInput = buildInput(`Phase7 Preview ${state.runId.slice(0, 6)}`);

  const dropsBefore = await query<{ n: string }>(`SELECT COUNT(*)::BIGINT AS n FROM drops`);
  const gvBefore = await query<{ n: string }>(
    `SELECT COUNT(*)::BIGINT AS n FROM pack_generation_versions`
  );

  const preview = await previewAdminDropComposition(previewInput);

  const dropsAfter = await query<{ n: string }>(`SELECT COUNT(*)::BIGINT AS n FROM drops`);
  const gvAfter = await query<{ n: string }>(
    `SELECT COUNT(*)::BIGINT AS n FROM pack_generation_versions`
  );

  checks.s1_preview_ready_for_well_formed_pool =
    preview.overallReady === true && preview.tiers.every((tier) => tier.readiness.ready);
  assert.equal(
    checks.s1_preview_ready_for_well_formed_pool,
    true,
    "Preview must report overallReady=true when all required rarities are seeded with >= cardsPerPack cards."
  );

  checks.s2_preview_has_no_side_effects =
    dropsBefore.rows[0].n === dropsAfter.rows[0].n && gvBefore.rows[0].n === gvAfter.rows[0].n;
  assert.equal(
    checks.s2_preview_has_no_side_effects,
    true,
    "Preview must not write to drops or pack_generation_versions."
  );

  // --------------------------------------------------------------------------
  // Create draft: must pin active_generation_version_id and write 3 composition rows.
  // This is the corrected §6 signal from the QA checklist (pinning happens at
  // draft-save, not at publish).
  // --------------------------------------------------------------------------
  const draftInput = buildInput(`Phase7 Draft ${state.runId.slice(0, 6)}`);
  const draft = await createAdminDropDraft(draftInput);
  state.createdDropIds.push(draft.id);

  const draftRow = await fetchDropRow(draft.id);
  checks.s3_create_draft_pins_generation_version =
    draftRow !== null &&
    draftRow.status === "draft" &&
    draftRow.published_at === null &&
    typeof draftRow.active_generation_version_id === "string" &&
    draftRow.active_generation_version_id.length > 0;
  assert.equal(
    checks.s3_create_draft_pins_generation_version,
    true,
    "Draft must have status='draft', published_at=NULL, and a non-null active_generation_version_id."
  );

  const pinnedVersionId = draftRow!.active_generation_version_id as string;
  const pinnedVersion = await fetchGenerationVersion(pinnedVersionId);
  checks.s3b_pinned_generation_version_row_exists = pinnedVersion !== null;
  assert.equal(
    checks.s3b_pinned_generation_version_row_exists,
    true,
    "drops.active_generation_version_id must reference an existing pack_generation_versions row."
  );

  checks.s4_create_draft_writes_tier_compositions = (await fetchCompositionCount(draft.id)) === PACK_TIERS.length;
  assert.equal(
    checks.s4_create_draft_writes_tier_compositions,
    true,
    "createAdminDropDraft must insert one drop_tier_compositions row per pack tier."
  );

  // --------------------------------------------------------------------------
  // Public listing excludes draft (Phase 7 scope: public drops hides draft).
  // --------------------------------------------------------------------------
  const publicDrops = await listDrops(100);
  checks.s5_public_listing_excludes_draft = !publicDrops.some((drop) => drop.id === draft.id);
  assert.equal(
    checks.s5_public_listing_excludes_draft,
    true,
    "listDrops() must exclude drops whose status is 'draft'."
  );

  // --------------------------------------------------------------------------
  // Content-dedup: creating a second draft with identical composition MUST
  // reuse the same pack_generation_versions row (same content_hash ⇒ same id).
  // --------------------------------------------------------------------------
  const twinInput = buildInput(`Phase7 Twin ${state.runId.slice(0, 6)}`);
  const twin = await createAdminDropDraft(twinInput);
  state.createdDropIds.push(twin.id);

  const twinRow = await fetchDropRow(twin.id);
  checks.s6_generation_version_content_dedup =
    twinRow !== null && twinRow.active_generation_version_id === pinnedVersionId;
  assert.equal(
    checks.s6_generation_version_content_dedup,
    true,
    "Two drafts with identical composition must share the same active_generation_version_id."
  );

  // --------------------------------------------------------------------------
  // Publish rejects insufficient pool. A composition that only includes 'common'
  // has zero uncommon/rare/ultra_rare cards available, so readiness fails for
  // every tier and publish must throw 409 INVALID_DROP_CONFIGURATION.
  // --------------------------------------------------------------------------
  const smallPoolInput = buildInput(`Phase7 SmallPool ${state.runId.slice(0, 6)}`, undefined, {
    standard: { includedRarities: ["common"] },
    premium: { includedRarities: ["common"] },
    elite: { includedRarities: ["common"] }
  });
  const smallPoolDraft = await createAdminDropDraft(smallPoolInput);
  state.createdDropIds.push(smallPoolDraft.id);

  let publishRejected = false;
  let publishRejectedCode: string | null = null;
  try {
    await publishAdminDrop(smallPoolDraft.id);
  } catch (error) {
    if (error instanceof AdminDropServiceError) {
      publishRejected = true;
      publishRejectedCode = error.code;
    } else {
      throw error;
    }
  }
  checks.s7_publish_rejects_small_pool = publishRejected && publishRejectedCode === "COMPOSITION_POOL_TOO_SMALL";
  assert.equal(
    checks.s7_publish_rejects_small_pool,
    true,
    "Publishing a draft whose composition yields eligibleCount < cardsPerPack for required rarities must throw COMPOSITION_POOL_TOO_SMALL."
  );

  // Confirm the small-pool draft stayed in 'draft' after the rejected publish.
  const smallPoolRow = await fetchDropRow(smallPoolDraft.id);
  checks.s7b_small_pool_still_draft = smallPoolRow?.status === "draft" && smallPoolRow?.published_at === null;
  assert.equal(
    checks.s7b_small_pool_still_draft,
    true,
    "A draft rejected by the publish gate must remain status='draft' with published_at=NULL."
  );

  // --------------------------------------------------------------------------
  // Publish flips status, sets published_at, preserves active_generation_version_id.
  // --------------------------------------------------------------------------
  const prePublishGvid = draftRow!.active_generation_version_id;
  const published = await publishAdminDrop(draft.id);
  const publishedRow = await fetchDropRow(draft.id);
  checks.s8_publish_flips_status_and_sets_published_at =
    published.status === "upcoming" &&
    published.publishedAt !== null &&
    publishedRow?.status === "upcoming" &&
    publishedRow.published_at !== null;
  assert.equal(
    checks.s8_publish_flips_status_and_sets_published_at,
    true,
    "publishAdminDrop must flip status draft→upcoming and set published_at."
  );

  checks.s9_publish_preserves_generation_version =
    publishedRow?.active_generation_version_id === prePublishGvid;
  assert.equal(
    checks.s9_publish_preserves_generation_version,
    true,
    "publishAdminDrop must not change active_generation_version_id (pinned at draft-save)."
  );

  // --------------------------------------------------------------------------
  // Double-publish must throw DROP_NOT_PUBLISHABLE (409).
  // --------------------------------------------------------------------------
  let doublePublishRejected = false;
  let doublePublishCode: string | null = null;
  try {
    await publishAdminDrop(draft.id);
  } catch (error) {
    if (error instanceof AdminDropServiceError) {
      doublePublishRejected = true;
      doublePublishCode = error.code;
    } else {
      throw error;
    }
  }
  checks.s10_double_publish_conflicts = doublePublishRejected && doublePublishCode === "DROP_NOT_PUBLISHABLE";
  assert.equal(
    checks.s10_double_publish_conflicts,
    true,
    "A second publishAdminDrop on an already-upcoming drop must throw DROP_NOT_PUBLISHABLE."
  );

  // --------------------------------------------------------------------------
  // Admin view of the drop after publish matches the DB row.
  // --------------------------------------------------------------------------
  const dropView = await getAdminDropById(draft.id);
  checks.s11_admin_view_reflects_published_state =
    dropView !== null &&
    dropView.status === "upcoming" &&
    dropView.publishedAt !== null &&
    dropView.tiers.length === PACK_TIERS.length;
  assert.equal(
    checks.s11_admin_view_reflects_published_state,
    true,
    "getAdminDropById must return the post-publish state (status='upcoming', publishedAt set, 3 tiers)."
  );

  // --------------------------------------------------------------------------
  // Admin card search: debounced upstream; here we verify the service itself
  // returns seeded cards and tolerates an injection-style query string.
  // --------------------------------------------------------------------------
  const cardSearchHit = await searchAdminCards({ query: "Phase7 Runtime Card", limit: 50 });
  checks.s12_card_search_finds_seeded = cardSearchHit.items.some((item) => state.cardIds.includes(item.id));
  assert.equal(
    checks.s12_card_search_finds_seeded,
    true,
    "searchAdminCards must find seeded Phase 7 fixture cards."
  );

  const injectionQuery = await searchAdminCards({ query: "' OR 1=1 --", limit: 10 });
  checks.s13_card_search_injection_safe = Array.isArray(injectionQuery.items);
  assert.equal(
    checks.s13_card_search_injection_safe,
    true,
    "searchAdminCards must not throw on an injection-style query and must return a well-formed result."
  );
}

async function main(): Promise<void> {
  const runId = randomUUID();
  const reportPath = `/tmp/partb-phase7-runtime-report-${runId}.json`;
  const checks: Record<string, boolean> = {
    preflight_db_ok: false,
    preflight_redis_ok: false,
    s1_preview_ready_for_well_formed_pool: false,
    s2_preview_has_no_side_effects: false,
    s3_create_draft_pins_generation_version: false,
    s3b_pinned_generation_version_row_exists: false,
    s4_create_draft_writes_tier_compositions: false,
    s5_public_listing_excludes_draft: false,
    s6_generation_version_content_dedup: false,
    s7_publish_rejects_small_pool: false,
    s7b_small_pool_still_draft: false,
    s8_publish_flips_status_and_sets_published_at: false,
    s9_publish_preserves_generation_version: false,
    s10_double_publish_conflicts: false,
    s11_admin_view_reflects_published_state: false,
    s12_card_search_finds_seeded: false,
    s13_card_search_injection_safe: false
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

    const schemaReady = await query<{ exists: boolean }>(
      `SELECT to_regclass('public.drop_tier_compositions') IS NOT NULL AS exists`
    );
    if (!schemaReady.rows[0]?.exists) {
      status = "BLOCKED_ENV";
      blockedReason =
        "Phase 7 migration not applied: table public.drop_tier_compositions is missing. " +
        "Run `psql \"$DATABASE_URL\" -f src/server/db/migrations/20260421_phase7_admin_drop_scheduler.sql`.";
      return;
    }

    const statusConstraintReady = await query<{ has_draft: boolean }>(
      `SELECT position('draft' IN pg_get_constraintdef(c.oid)) > 0 AS has_draft
       FROM pg_constraint c
       WHERE c.conname = 'drops_status_check'`
    );
    if (!statusConstraintReady.rows[0]?.has_draft) {
      status = "BLOCKED_ENV";
      blockedReason =
        "Phase 7 migration not fully applied: drops_status_check does not allow 'draft'. " +
        "Re-run the Phase 7 migration.";
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
      mode: "lite",
      status,
      generatedAtIso: new Date().toISOString(),
      checks,
      blockedReason,
      failureReason
    };

    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    if (status === "PASS") {
      console.log(`[test:partb:phase7:runtime] PASS report=${reportPath}`);
      return;
    }

    if (status === "BLOCKED_ENV") {
      console.log(
        `[test:partb:phase7:runtime] BLOCKED_ENV report=${reportPath} reason=${blockedReason ?? "unknown"}`
      );
      process.exitCode = 2;
      return;
    }

    console.error(`[test:partb:phase7:runtime] FAIL report=${reportPath} reason=${failureReason ?? "unknown"}`);
    process.exitCode = 1;
  }
}

void main();
