import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { writeFile } from "node:fs/promises";
import net from "node:net";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { PACK_PRICE_CENTS } from "../src/server/config/constants";
import { closeDatabasePool, query, withTransaction } from "../src/server/db/pool";
import {
  initializeDropLotteryActivation,
  inspectDropLotteryStateForTest,
  resetDropLotteryWindowForTest
} from "../src/server/services/drop-lottery.service";
import { createEncryptedServerSeed, ensureNonceCounterRow } from "../src/server/services/fairness.service";
import { ensureLatestGenerationVersion } from "../src/server/services/pack-generation-version.service";
import { closeRedisClients } from "../src/server/redis/client";
import { createSupabaseAnonClient, createSupabaseServiceClient } from "../src/server/supabase/client";

type HealthResponse = {
  status: string;
};

type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
};

type PurchaseSuccessBody = {
  purchase?: {
    packId: string;
  };
};

type QaUser = {
  id: string;
  email: string;
  username: string;
  password: string;
  accessToken: string;
};

type DropFixture = {
  dropId: string;
  dropPackId: string;
  serverSeedId: string;
  tier: "standard";
  totalInventory: number;
};

type RequestFinalOutcome = {
  status: number;
  code: string;
  retryAfterMs: number | null;
  resetHintPresent: boolean;
  attempts: number;
};

type ScenarioSummary = {
  totalRequests: number;
  successCount: number;
  statusCounts: Record<string, number>;
  codeCounts: Record<string, number>;
  loserWithResetHintCount: number;
  outcomes: RequestFinalOutcome[];
};

type EventCount = Record<string, number>;

type UniformitySummary = {
  trials: number;
  participantsPerTrial: number;
  cohortSizePerTrial: number;
  expectedWinsPerParticipant: number;
  observedWinsPerParticipant: Record<string, number>;
  chiSquared: number;
  chiSquaredThreshold: number;
  minObservedWins: number;
  maxObservedWins: number;
  nonLotteryOutcomeCount: number;
  pass: boolean;
  failReason: string | null;
};

type RuntimeQaReport = {
  runId: string;
  generatedAtIso: string;
  serverPortMain: number;
  serverPortDegrade: number;
  mainDrop: {
    dropId: string;
    dropPackId: string;
    totalInventory: number;
    beforeRemaining: number;
    afterRemaining: number;
    successfulPurchasesRecorded: number;
  };
  burst: ScenarioSummary;
  uniformity: UniformitySummary;
  postWindowFcfs: ScenarioSummary;
  rateLimitProbe: ScenarioSummary;
  securityEventsMain: EventCount;
  degradeScenario: {
    response: RequestFinalOutcome;
    securityEvents: EventCount;
  };
  checks: Record<string, boolean>;
};

type RuntimeState = {
  runId: string;
  reportPath: string;
  seededCardIds: string[];
  qaUsers: QaUser[];
  supabaseUserIds: string[];
  fixtures: DropFixture[];
  requestKeyPrefixes: {
    main: string;
    degrade: string;
  };
  startedAtIso: string;
};

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

const SERVER_BOOT_TIMEOUT_MS = 90_000;
const DEFAULT_USER_BALANCE_CENTS = 80_000;
const RATE_LIMIT_PROBE_ATTEMPTS = envInt("PARTB_PHASE4_RATE_LIMIT_PROBE_ATTEMPTS", 7);
const RATE_LIMIT_PROBE_EXPECTED_HITS = envInt("PARTB_PHASE4_RATE_LIMIT_PROBE_EXPECTED_HITS", 2);
const BURST_PARTICIPANT_COUNT = envInt("PARTB_PHASE4_BURST_PARTICIPANT_COUNT", 100);
const MAIN_DROP_INVENTORY = envInt("PARTB_PHASE4_MAIN_DROP_INVENTORY", 30);
const POST_WINDOW_PARTICIPANT_COUNT = envInt("PARTB_PHASE4_POST_WINDOW_PARTICIPANT_COUNT", 10);
const TOTAL_QA_USERS = Math.max(BURST_PARTICIPANT_COUNT, POST_WINDOW_PARTICIPANT_COUNT);
const UNIFORMITY_TRIAL_COUNT = envInt("PARTB_PHASE4_UNIFORMITY_TRIAL_COUNT", 20);
const UNIFORMITY_PARTICIPANT_COUNT = Math.min(
  envInt("PARTB_PHASE4_UNIFORMITY_PARTICIPANT_COUNT", 20),
  TOTAL_QA_USERS
);
const UNIFORMITY_COHORT_SIZE = envInt("PARTB_PHASE4_UNIFORMITY_COHORT_SIZE", 8);
const UNIFORMITY_CHI_SQUARED_THRESHOLD = envInt("PARTB_PHASE4_UNIFORMITY_CHI_SQUARED_THRESHOLD", 60);
const UNIFORMITY_ACTIVATION_SKEW_MS = 9_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireEnv(): void {
  const required = [
    "DATABASE_URL",
    "REDIS_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "PACK_FAIRNESS_SECRET"
  ];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`${key} is required for test:partb:phase4:runtime.`);
    }
  }
}

function buildQaUsername(runId: string, index: number): string {
  const suffix = runId.split("-").at(-1) ?? runId.slice(-8);
  const username = `p4rt_${suffix}_${index}`;
  return username.slice(0, 32);
}

async function pickOpenPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to resolve ephemeral test port.")));
        return;
      }

      const selectedPort = address.port;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(selectedPort);
      });
    });
  });
}

async function waitForHealth(port: number, timeoutMs = SERVER_BOOT_TIMEOUT_MS): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`, { method: "GET" });
      if (response.ok) {
        const payload = (await response.json()) as HealthResponse;
        if (payload.status === "ok") {
          return;
        }
      }
    } catch {
      // Keep polling while server boots.
    }

    await sleep(300);
  }

  throw new Error(`Timed out waiting for server health on port ${port}.`);
}

async function stopServer(serverProcess: ChildProcess): Promise<void> {
  if (serverProcess.killed || serverProcess.exitCode !== null) {
    return;
  }

  serverProcess.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      serverProcess.kill("SIGKILL");
      resolve();
    }, 15_000);

    serverProcess.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function startServer(port: number, overrides: Record<string, string | undefined> = {}): Promise<ChildProcess> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port)
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === "undefined") {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  const child: ChildProcess = spawn("node", ["--import", "tsx", "server.ts"], {
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const startupLogs: string[] = [];
  const tag = `[server:${port}] `;
  const forwardToStderr = process.env.PARTB_PHASE4_SERVER_LOGS !== "off";
  const capture = (chunk: Buffer): void => {
    const text = chunk.toString("utf8");
    startupLogs.push(text);
    if (startupLogs.length > 100) {
      startupLogs.shift();
    }
    if (forwardToStderr) {
      // Tag each line with server port so interleaved output from the
      // main/degrade servers is unambiguous while debugging.
      const tagged = text.replace(/\n(?=.)/g, `\n${tag}`);
      process.stderr.write(`${tag}${tagged}`);
    }
  };

  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);

  await Promise.race([
    waitForHealth(port),
    new Promise<never>((_, reject) => {
      child.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
        reject(
          new Error(
            `Server exited before healthcheck (code=${String(code)}, signal=${String(signal)}).\n` +
              `Recent logs:\n${startupLogs.join("")}`
          )
        );
      });
    })
  ]);

  return child;
}

async function ensureCatalogCoverage(state: RuntimeState): Promise<void> {
  const existing = await query<{ rarity_tier: string; count: string }>(
    `SELECT rarity_tier::text AS rarity_tier, COUNT(*)::BIGINT AS count
     FROM pokemon_cards
     GROUP BY rarity_tier`
  );

  const counts = new Map<string, number>();
  for (const row of existing.rows) {
    counts.set(row.rarity_tier, Number(row.count));
  }

  const rarities = ["common", "uncommon", "rare", "holo_rare", "ultra_rare", "chase"] as const;
  for (const rarity of rarities) {
    if ((counts.get(rarity) ?? 0) > 0) {
      continue;
    }

    const cardId = randomUUID();
    state.seededCardIds.push(cardId);
    await query(
      `INSERT INTO pokemon_cards (
         id, tcg_id, name, set_name, set_id, rarity, rarity_tier, image_url, image_url_hires, current_price, previous_price
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, $8, $9)`,
      [
        cardId,
        `phase4-runtime-${state.runId}-${rarity}`,
        `Phase4 Runtime ${rarity}`,
        "Phase4 Runtime Set",
        "phase4-runtime-set",
        rarity,
        rarity,
        100,
        100
      ]
    );
  }
}

async function createDropFixture(
  tier: "standard",
  totalInventory: number,
  state: RuntimeState
): Promise<DropFixture> {
  return withTransaction(async (client) => {
    const generationVersion = await ensureLatestGenerationVersion(client);

    const dropId = randomUUID();
    const dropPackId = randomUUID();
    await client.query(
      `INSERT INTO drops (id, scheduled_at, status, active_generation_version_id)
       VALUES ($1, now(), 'active', $2)`,
      [dropId, generationVersion.id]
    );

    await client.query(
      `INSERT INTO drop_packs (id, drop_id, tier, price, total_inventory, remaining_inventory)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [dropPackId, dropId, tier, PACK_PRICE_CENTS[tier], totalInventory]
    );

    const encryptedSeed = createEncryptedServerSeed();
    const seedResult = await client.query<{ id: string }>(
      `INSERT INTO server_seeds (
         drop_id,
         seed_hash,
         seed_value_ciphertext,
         seed_iv,
         seed_auth_tag
       )
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [dropId, encryptedSeed.seedHash, encryptedSeed.ciphertext, encryptedSeed.iv, encryptedSeed.authTag]
    );

    const serverSeedId = seedResult.rows[0].id;
    await ensureNonceCounterRow(client, serverSeedId);

    const fixture = {
      dropId,
      dropPackId,
      serverSeedId,
      tier,
      totalInventory
    } satisfies DropFixture;

    state.fixtures.push(fixture);
    return fixture;
  });
}

async function createQaUser(index: number, state: RuntimeState): Promise<QaUser> {
  const serviceClient = createSupabaseServiceClient();
  const anonClient = createSupabaseAnonClient();

  const email = `phase4_runtime_${state.runId}_${index}@test.local`;
  const username = buildQaUsername(state.runId, index);
  const password = `Pv!Phase4Runtime_${index}_${state.runId}`;

  const created = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      username
    }
  });

  if (created.error || !created.data.user?.id) {
    throw new Error(`Failed to create Supabase QA user (${email}): ${created.error?.message ?? "unknown error"}`);
  }

  const userId = created.data.user.id;
  state.supabaseUserIds.push(userId);

  await query(
    `INSERT INTO users (id, username, email, balance)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE
     SET username = EXCLUDED.username,
         email = EXCLUDED.email`,
    [userId, username, email, DEFAULT_USER_BALANCE_CENTS]
  );

  let accessToken: string | null = null;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const login = await anonClient.auth.signInWithPassword({
      email,
      password
    });

    if (!login.error && login.data.session?.access_token) {
      accessToken = login.data.session.access_token;
      break;
    }

    const message = login.error?.message ?? "no access token";
    const isRateLimit = message.toLowerCase().includes("rate limit");
    if (!isRateLimit || attempt === 10) {
      throw new Error(`Failed to sign in QA user (${email}): ${message}`);
    }

    await sleep(250 * attempt);
  }

  if (!accessToken) {
    throw new Error(`Failed to sign in QA user (${email}): no access token`);
  }

  const qaUser: QaUser = {
    id: userId,
    email,
    username,
    password,
    accessToken
  };
  state.qaUsers.push(qaUser);
  return qaUser;
}

async function createQaUsers(count: number, state: RuntimeState): Promise<QaUser[]> {
  const users: QaUser[] = [];
  for (let index = 0; index < count; index += 1) {
    const user = await createQaUser(index, state);
    users.push(user);
    await sleep(100);
  }
  return users;
}

async function fetchRemainingInventory(dropPackId: string): Promise<number> {
  const result = await query<{ remaining_inventory: string }>(
    `SELECT remaining_inventory::text AS remaining_inventory
     FROM drop_packs
     WHERE id = $1`,
    [dropPackId]
  );

  return Number(result.rows[0]?.remaining_inventory ?? "0");
}

async function fetchPackCountByDropPack(dropPackId: string): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*)::BIGINT AS count
     FROM packs
     WHERE drop_pack_id = $1`,
    [dropPackId]
  );
  return Number(result.rows[0]?.count ?? "0");
}

async function requestPurchase(input: {
  port: number;
  dropId: string;
  tier: "standard";
  token: string;
  ip: string;
  requestKey: string;
}): Promise<RequestFinalOutcome> {
  const response = await fetch(`http://127.0.0.1:${input.port}/api/drops/${input.dropId}/purchase`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.token}`,
      "x-forwarded-for": input.ip,
      "x-request-id": input.requestKey
    },
    body: JSON.stringify({ tier: input.tier })
  });

  let payload: ApiErrorBody & PurchaseSuccessBody = {};
  try {
    payload = (await response.json()) as ApiErrorBody & PurchaseSuccessBody;
  } catch {
    payload = {};
  }

  if (response.status === 201 && payload.purchase?.packId) {
    return {
      status: 201,
      code: "PURCHASE_CREATED",
      retryAfterMs: null,
      resetHintPresent: false,
      attempts: 1
    };
  }

  const finalCode = payload.error?.code ?? "UNKNOWN";
  const maybeRetry = payload.error?.details?.retryAfterMs;
  const finalRetryAfter = typeof maybeRetry === "number" ? maybeRetry : null;

  return {
    status: response.status,
    code: finalCode,
    retryAfterMs: finalRetryAfter,
    resetHintPresent: finalRetryAfter !== null,
    attempts: 1
  };
}

function summarizeOutcomes(outcomes: RequestFinalOutcome[]): ScenarioSummary {
  const statusCounts: Record<string, number> = {};
  const codeCounts: Record<string, number> = {};
  let successCount = 0;
  let loserWithResetHintCount = 0;

  for (const outcome of outcomes) {
    const statusKey = String(outcome.status);
    statusCounts[statusKey] = (statusCounts[statusKey] ?? 0) + 1;
    codeCounts[outcome.code] = (codeCounts[outcome.code] ?? 0) + 1;
    if (outcome.status === 201) {
      successCount += 1;
    }
    if (outcome.code === "WAITING_ROOM_LOST_LOTTERY" && outcome.resetHintPresent) {
      loserWithResetHintCount += 1;
    }
  }

  return {
    totalRequests: outcomes.length,
    successCount,
    statusCounts,
    codeCounts,
    loserWithResetHintCount,
    outcomes
  };
}

async function fetchSecurityEventCountsByPrefix(requestKeyPrefix: string): Promise<EventCount> {
  const result = await query<{ event_type: string; count: string }>(
    `SELECT event_type, COUNT(*)::BIGINT AS count
     FROM security_events
     WHERE request_key LIKE $1
     GROUP BY event_type`,
    [`${requestKeyPrefix}%`]
  );

  const mapped: EventCount = {};
  for (const row of result.rows) {
    mapped[row.event_type] = Number(row.count);
  }
  return mapped;
}

async function fetchLotteryDecisionByRequestPrefix(requestKeyPrefix: string): Promise<Map<string, "lottery_win" | "lottery_loss">> {
  const result = await query<{ request_key: string; event_type: "lottery_win" | "lottery_loss" }>(
    `SELECT request_key, event_type
     FROM security_events
     WHERE request_key LIKE $1
       AND event_type IN ('lottery_win', 'lottery_loss')
       AND request_key IS NOT NULL`,
    [`${requestKeyPrefix}%`]
  );

  const decisions = new Map<string, "lottery_win" | "lottery_loss">();
  for (const row of result.rows) {
    if (!decisions.has(row.request_key)) {
      decisions.set(row.request_key, row.event_type);
    }
  }
  return decisions;
}

async function waitForLotteryDecisionByPrefix(
  requestKeyPrefix: string,
  expectedCount: number
): Promise<Map<string, "lottery_win" | "lottery_loss">> {
  const deadlineMs = Date.now() + 3_000;
  while (Date.now() <= deadlineMs) {
    const decisions = await fetchLotteryDecisionByRequestPrefix(requestKeyPrefix);
    if (decisions.size >= expectedCount) {
      return decisions;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return fetchLotteryDecisionByRequestPrefix(requestKeyPrefix);
}

function computeChiSquared(observed: number[], expected: number): number {
  if (expected <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  let value = 0;
  for (const observedValue of observed) {
    const delta = observedValue - expected;
    value += (delta * delta) / expected;
  }
  return value;
}

async function runUniformityTrials(input: {
  port: number;
  users: QaUser[];
  state: RuntimeState;
}): Promise<UniformitySummary> {
  const participants = input.users.slice(0, UNIFORMITY_PARTICIPANT_COUNT);
  assert.equal(
    participants.length,
    UNIFORMITY_PARTICIPANT_COUNT,
    `Expected ${UNIFORMITY_PARTICIPANT_COUNT} users for uniformity check.`
  );

  const observedWins = new Map<string, number>();
  for (const user of participants) {
    observedWins.set(user.id, 0);
  }

  let nonLotteryOutcomeCount = 0;
  const cohortSizePerTrial = UNIFORMITY_COHORT_SIZE + Math.min(5, Math.floor(UNIFORMITY_COHORT_SIZE * 0.2));

  for (let trial = 0; trial < UNIFORMITY_TRIAL_COUNT; trial += 1) {
    const fixture = await createDropFixture("standard", UNIFORMITY_COHORT_SIZE, input.state);
    await initializeDropLotteryActivation(fixture.dropId, Date.now() - UNIFORMITY_ACTIVATION_SKEW_MS);

    const requestPrefix = `${input.state.requestKeyPrefixes.main}uniformity-${trial}-`;
    const requestKeyToUser = new Map<string, string>();
    const outcomes = await Promise.all(
      participants.map((user, index) => {
        const requestKey = `${requestPrefix}${index}`;
        requestKeyToUser.set(requestKey, user.id);
        return requestPurchase({
          port: input.port,
          dropId: fixture.dropId,
          tier: "standard",
          token: user.accessToken,
          ip: `172.16.${trial % 200}.${(index % 200) + 1}`,
          requestKey
        });
      })
    );

    const decisions = await waitForLotteryDecisionByPrefix(requestPrefix, participants.length);
    for (const [requestKey, userId] of requestKeyToUser) {
      const decision = decisions.get(requestKey);
      if (decision === "lottery_win") {
        observedWins.set(userId, (observedWins.get(userId) ?? 0) + 1);
        continue;
      }
      if (decision !== "lottery_loss") {
        nonLotteryOutcomeCount += 1;
      }
    }

    for (const outcome of outcomes) {
      const isExpectedOutcome =
        outcome.code === "WAITING_ROOM_LOST_LOTTERY" ||
        outcome.code === "PURCHASE_CREATED" ||
        outcome.code === "SOLD_OUT";
      if (!isExpectedOutcome) {
        nonLotteryOutcomeCount += 1;
      }
    }
  }

  const expectedWinsPerParticipant = (UNIFORMITY_TRIAL_COUNT * cohortSizePerTrial) / participants.length;
  const observedValues = participants.map((user) => observedWins.get(user.id) ?? 0);
  const chiSquared = computeChiSquared(observedValues, expectedWinsPerParticipant);
  const minObservedWins = Math.min(...observedValues);
  const maxObservedWins = Math.max(...observedValues);
  const pass = nonLotteryOutcomeCount === 0 && chiSquared <= UNIFORMITY_CHI_SQUARED_THRESHOLD;
  const failReason =
    nonLotteryOutcomeCount > 0
      ? `Non-lottery outcomes detected (${nonLotteryOutcomeCount}).`
      : chiSquared > UNIFORMITY_CHI_SQUARED_THRESHOLD
        ? `Chi-squared ${chiSquared.toFixed(2)} exceeded threshold ${UNIFORMITY_CHI_SQUARED_THRESHOLD}.`
        : null;

  return {
    trials: UNIFORMITY_TRIAL_COUNT,
    participantsPerTrial: participants.length,
    cohortSizePerTrial,
    expectedWinsPerParticipant,
    observedWinsPerParticipant: Object.fromEntries(observedWins.entries()),
    chiSquared,
    chiSquaredThreshold: UNIFORMITY_CHI_SQUARED_THRESHOLD,
    minObservedWins,
    maxObservedWins,
    nonLotteryOutcomeCount,
    pass,
    failReason
  };
}

async function cleanupFixture(fixture: DropFixture): Promise<void> {
  await withTransaction(async (client) => {
    const packIds = await client.query<{ id: string }>(
      `SELECT id
       FROM packs
       WHERE drop_pack_id = $1`,
      [fixture.dropPackId]
    );
    const ids = packIds.rows.map((row) => row.id);

    if (ids.length > 0) {
      await client.query(`DELETE FROM transactions WHERE reference_id = ANY($1::uuid[])`, [ids]);
      await client.query(`DELETE FROM platform_revenue WHERE reference_id = ANY($1::uuid[])`, [ids]);
      await client.query(`DELETE FROM cards WHERE pack_id = ANY($1::uuid[])`, [ids]);
      await client.query(`DELETE FROM pack_commitments WHERE pack_id = ANY($1::uuid[])`, [ids]);
      await client.query(`DELETE FROM packs WHERE id = ANY($1::uuid[])`, [ids]);
    }

    await client.query(`DELETE FROM drop_packs WHERE id = $1`, [fixture.dropPackId]);
    await client.query(`DELETE FROM server_seed_nonce_counters WHERE server_seed_id = $1`, [fixture.serverSeedId]);
    await client.query(`DELETE FROM server_seeds WHERE drop_id = $1`, [fixture.dropId]);
    await client.query(`DELETE FROM drops WHERE id = $1`, [fixture.dropId]);
  });
}

async function cleanupState(state: RuntimeState): Promise<void> {
  for (const fixture of state.fixtures) {
    await cleanupFixture(fixture);
  }

  // security_events has a FK to users; must be deleted before users.
  // Filter by both request_key prefix (covers rows with no user_id) and
  // user_id (covers any row attributable to a QA user regardless of prefix).
  await query(`DELETE FROM security_events WHERE request_key LIKE $1 OR request_key LIKE $2`, [
    `${state.requestKeyPrefixes.main}%`,
    `${state.requestKeyPrefixes.degrade}%`
  ]);
  if (state.qaUsers.length > 0) {
    const userIds = state.qaUsers.map((user) => user.id);
    await query(`DELETE FROM security_events WHERE user_id = ANY($1::uuid[])`, [userIds]);
    await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
  }

  const supabaseAdmin = createSupabaseServiceClient();
  for (const userId of state.supabaseUserIds) {
    const deleted = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleted.error) {
      console.warn(`[test:partb:phase4:runtime] Failed to delete Supabase user ${userId}: ${deleted.error.message}`);
    }
  }

  if (state.seededCardIds.length > 0) {
    await query(`DELETE FROM pokemon_cards WHERE id = ANY($1::uuid[])`, [state.seededCardIds]);
  }
}

function ensurePositiveCount(label: string, value: number): void {
  assert.ok(value > 0, `${label} must be > 0.`);
}

async function main(): Promise<void> {
  requireEnv();

  const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const reportPath =
    process.env.PARTB_PHASE4_RUNTIME_REPORT ??
    `/tmp/phase4-runtime-report-${runId}.json`;
  const state: RuntimeState = {
    runId,
    reportPath,
    seededCardIds: [],
    qaUsers: [],
    supabaseUserIds: [],
    fixtures: [],
    requestKeyPrefixes: {
      main: `phase4-runtime:${runId}:main:`,
      degrade: `phase4-runtime:${runId}:degrade:`
    },
    startedAtIso: new Date().toISOString()
  };

  let mainServer: ChildProcess | null = null;
  let degradeServer: ChildProcess | null = null;

  try {
    console.log(
      `[test:partb:phase4:runtime] scale: users=${TOTAL_QA_USERS} burst=${BURST_PARTICIPANT_COUNT} ` +
        `mainInv=${MAIN_DROP_INVENTORY} uniformity=${UNIFORMITY_TRIAL_COUNT}x${UNIFORMITY_PARTICIPANT_COUNT} ` +
        `cohort=${UNIFORMITY_COHORT_SIZE} postWindow=${POST_WINDOW_PARTICIPANT_COUNT}`
    );

    console.log("[test:partb:phase4:runtime] [1/8] ensuring catalog coverage...");
    await ensureCatalogCoverage(state);

    console.log(`[test:partb:phase4:runtime] [2/8] creating ${TOTAL_QA_USERS} Supabase QA users...`);
    const users = await createQaUsers(TOTAL_QA_USERS, state);

    console.log("[test:partb:phase4:runtime] [3/8] creating main drop fixture...");
    const mainFixture = await createDropFixture("standard", MAIN_DROP_INVENTORY, state);
    const beforeRemaining = await fetchRemainingInventory(mainFixture.dropPackId);

    console.log("[test:partb:phase4:runtime] [4/8] booting main server...");
    const mainPort = await pickOpenPort();
    const mainLotteryKey = process.env.SERVER_LOTTERY_KEY ?? randomBytes(32).toString("hex");
    mainServer = await startServer(mainPort, { SERVER_LOTTERY_KEY: mainLotteryKey });

    // Reset window AFTER server boot so the 10s lottery window covers the burst.
    await resetDropLotteryWindowForTest(mainFixture.dropId, Date.now());
    const preBurstState = await inspectDropLotteryStateForTest(mainFixture.dropId);
    console.log(
      `[test:partb:phase4:runtime] pre-burst lotteryState=${JSON.stringify({
        ...preBurstState,
        nowMs: Date.now()
      })}`
    );

    console.log(`[test:partb:phase4:runtime] [5/8] burst of ${BURST_PARTICIPANT_COUNT} purchases...`);
    const burstParticipants = users.slice(0, BURST_PARTICIPANT_COUNT);
    const burstOutcomes = await Promise.all(
      burstParticipants.map((user, index) =>
        requestPurchase({
          port: mainPort,
          dropId: mainFixture.dropId,
          tier: "standard",
          token: user.accessToken,
          ip: `198.51.100.${(index % 200) + 1}`,
          requestKey: `${state.requestKeyPrefixes.main}burst-${index}`
        })
      )
    );
    const burstSummary = summarizeOutcomes(burstOutcomes);
    const postBurstState = await inspectDropLotteryStateForTest(mainFixture.dropId);
    console.log(
      `[test:partb:phase4:runtime] post-burst lotteryState=${JSON.stringify({
        ...postBurstState,
        nowMs: Date.now()
      })}`
    );

    console.log(
      `[test:partb:phase4:runtime] [6/8] uniformity ${UNIFORMITY_TRIAL_COUNT} trials x ${UNIFORMITY_PARTICIPANT_COUNT} users...`
    );
    const uniformitySummary = await runUniformityTrials({
      port: mainPort,
      users,
      state
    });

    await new Promise((resolve) => setTimeout(resolve, 1_500));

    console.log("[test:partb:phase4:runtime] [7/8] post-window FCFS + rate-limit probe...");
    const postWindowParticipants = users.slice(0, POST_WINDOW_PARTICIPANT_COUNT);
    const postWindowOutcomes = await Promise.all(
      postWindowParticipants.map((user, index) =>
        requestPurchase({
          port: mainPort,
          dropId: mainFixture.dropId,
          tier: "standard",
          token: user.accessToken,
          ip: `203.0.113.${(index % 200) + 1}`,
          requestKey: `${state.requestKeyPrefixes.main}post-${index}`
        })
      )
    );
    const postWindowSummary = summarizeOutcomes(postWindowOutcomes);

    // Dedicated rate-limit probe (same user + same IP, rapid requests).
    const rateLimitUser = users[0];
    const rateProbeFixture = await createDropFixture("standard", 20, state);
    await initializeDropLotteryActivation(rateProbeFixture.dropId, Date.now() - 20_000);
    const rateOutcomes: RequestFinalOutcome[] = [];
    for (let attempt = 0; attempt < RATE_LIMIT_PROBE_ATTEMPTS; attempt += 1) {
      rateOutcomes.push(
        await requestPurchase({
          port: mainPort,
          dropId: rateProbeFixture.dropId,
          tier: "standard",
          token: rateLimitUser.accessToken,
          ip: "10.10.10.10",
          requestKey: `${state.requestKeyPrefixes.main}ratelimit-${attempt}`
        })
      );
    }
    const rateLimitSummary = summarizeOutcomes(rateOutcomes);

    const afterRemaining = await fetchRemainingInventory(mainFixture.dropPackId);
    const successfulPurchasesRecorded = await fetchPackCountByDropPack(mainFixture.dropPackId);
    const securityEventsMain = await fetchSecurityEventCountsByPrefix(state.requestKeyPrefixes.main);

    await stopServer(mainServer);
    mainServer = null;

    console.log("[test:partb:phase4:runtime] [8/8] degrade scenario (no SERVER_LOTTERY_KEY)...");
    // Degradation scenario: lottery unavailable (missing SERVER_LOTTERY_KEY), FCFS still works.
    const degradePort = await pickOpenPort();
    degradeServer = await startServer(degradePort, { SERVER_LOTTERY_KEY: undefined });
    const degradeFixture = await createDropFixture("standard", 5, state);
    await initializeDropLotteryActivation(degradeFixture.dropId, Date.now());

    const degradeUser = users[1];
    const degradeOutcome = await requestPurchase({
      port: degradePort,
      dropId: degradeFixture.dropId,
      tier: "standard",
      token: degradeUser.accessToken,
      ip: "198.18.0.10",
      requestKey: `${state.requestKeyPrefixes.degrade}single`
    });
    const securityEventsDegrade = await fetchSecurityEventCountsByPrefix(state.requestKeyPrefixes.degrade);

    const checks: Record<string, boolean> = {
      burst_uses_waiting_room: (burstSummary.codeCounts.WAITING_ROOM_LOST_LOTTERY ?? 0) > 0,
      no_external_waiting_room_pending: (burstSummary.codeCounts.WAITING_ROOM_PENDING ?? 0) === 0,
      losers_have_reset_hint:
        (burstSummary.codeCounts.WAITING_ROOM_LOST_LOTTERY ?? 0) === 0 ||
        burstSummary.loserWithResetHintCount === (burstSummary.codeCounts.WAITING_ROOM_LOST_LOTTERY ?? 0),
      uniformity_cohort_selection_is_uniform: uniformitySummary.pass,
      post_window_is_fcfs:
        (postWindowSummary.codeCounts.WAITING_ROOM_LOST_LOTTERY ?? 0) === 0,
      inventory_never_oversold:
        successfulPurchasesRecorded <= mainFixture.totalInventory &&
        beforeRemaining >= afterRemaining &&
        afterRemaining >= 0,
      inventory_delta_matches_success:
        beforeRemaining - afterRemaining === successfulPurchasesRecorded,
      security_events_lottery_win_logged: (securityEventsMain.lottery_win ?? 0) > 0,
      security_events_lottery_loss_logged: (securityEventsMain.lottery_loss ?? 0) > 0,
      security_events_rate_limit_logged: (securityEventsMain.rate_limit_hit ?? 0) >= RATE_LIMIT_PROBE_EXPECTED_HITS,
      lottery_unavailable_degrades_to_fcfs:
        degradeOutcome.code !== "WAITING_ROOM_LOST_LOTTERY",
      security_events_lottery_unavailable_logged: (securityEventsDegrade.lottery_unavailable ?? 0) > 0
    };

    const report: RuntimeQaReport = {
      runId,
      generatedAtIso: new Date().toISOString(),
      serverPortMain: mainPort,
      serverPortDegrade: degradePort,
      mainDrop: {
        dropId: mainFixture.dropId,
        dropPackId: mainFixture.dropPackId,
        totalInventory: mainFixture.totalInventory,
        beforeRemaining,
        afterRemaining,
        successfulPurchasesRecorded
      },
      burst: burstSummary,
      uniformity: uniformitySummary,
      postWindowFcfs: postWindowSummary,
      rateLimitProbe: rateLimitSummary,
      securityEventsMain,
      degradeScenario: {
        response: degradeOutcome,
        securityEvents: securityEventsDegrade
      },
      checks
    };

    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

    console.log(
      `[test:partb:phase4:runtime] burst codeCounts=${JSON.stringify(burstSummary.codeCounts)} ` +
        `statusCounts=${JSON.stringify(burstSummary.statusCounts)}`
    );
    console.log(
      `[test:partb:phase4:runtime] mainDrop before=${beforeRemaining} after=${afterRemaining} ` +
        `packsRecorded=${successfulPurchasesRecorded}`
    );
    console.log(
      `[test:partb:phase4:runtime] securityEventsMain=${JSON.stringify(securityEventsMain)}`
    );
    console.log(
      `[test:partb:phase4:runtime] uniformity pass=${uniformitySummary.pass} chi2=${uniformitySummary.chiSquared.toFixed(2)} nonLotteryOutcomes=${uniformitySummary.nonLotteryOutcomeCount}`
    );
    console.log(
      `[test:partb:phase4:runtime] postWindow codeCounts=${JSON.stringify(postWindowSummary.codeCounts)}`
    );
    console.log(
      `[test:partb:phase4:runtime] rateLimit codeCounts=${JSON.stringify(rateLimitSummary.codeCounts)}`
    );
    console.log(
      `[test:partb:phase4:runtime] degrade outcome=${JSON.stringify(degradeOutcome)} events=${JSON.stringify(securityEventsDegrade)}`
    );
    console.log(`[test:partb:phase4:runtime] checks=${JSON.stringify(checks)}`);
    console.log(`[test:partb:phase4:runtime] Report: ${reportPath}`);

    for (const [checkName, passed] of Object.entries(checks)) {
      assert.equal(passed, true, `Check failed: ${checkName}`);
    }

    ensurePositiveCount("lottery_loss count", securityEventsMain.lottery_loss ?? 0);
    ensurePositiveCount("lottery_win count", securityEventsMain.lottery_win ?? 0);

    console.log(`[test:partb:phase4:runtime] PASS`);
    console.log(`[test:partb:phase4:runtime] Report: ${reportPath}`);
  } finally {
    await Promise.allSettled([
      mainServer ? stopServer(mainServer) : Promise.resolve(),
      degradeServer ? stopServer(degradeServer) : Promise.resolve()
    ]);

    await cleanupState(state);
  }
}

main()
  .catch((error) => {
    console.error("[test:partb:phase4:runtime] FAIL", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([closeDatabasePool(), closeRedisClients()]);
  });
