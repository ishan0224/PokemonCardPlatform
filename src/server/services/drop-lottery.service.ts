import { createHmac, randomUUID } from "crypto";
import type { DropStatus } from "../../lib/types";
import { query } from "../db/pool";
import { getRedisClient, isRedisConfigured } from "../redis/client";

const WAITING_ROOM_WINDOW_MS = 10_000;
const WAITING_ROOM_CLOSE_GRACE_MS = 500;
const WINNER_PRIORITY_TTL_MS = 5_000;
const LOTTERY_STATE_TTL_MS = 60 * 60 * 1000;

// Inlined from src/server/redis/lua/claim_lottery.lua.
// Kept inline so route modules do not depend on filesystem paths that are
// unreliable inside Next's bundled app-route runtime (__dirname is unstable
// for non-code assets after bundling).
const CLAIM_LOTTERY_SCRIPT = `redis.call("ZADD", KEYS[1], "NX", ARGV[2], ARGV[1])
redis.call("PEXPIRE", KEYS[1], ARGV[4])

local closed = redis.call("GET", KEYS[2])
if closed ~= "1" then
  return { "pending" }
end

local cohortSize = tonumber(redis.call("GET", KEYS[3]) or "0")
if cohortSize <= 0 then
  return { "loser" }
end

local cohort = redis.call("ZRANGEBYSCORE", KEYS[1], "-inf", "+inf", "LIMIT", 0, cohortSize)
for i = 1, #cohort do
  if cohort[i] == ARGV[1] then
    redis.call("PSETEX", KEYS[4], ARGV[3], "1")
    return { "winner" }
  end
end

return { "loser" }
`;

type DropLotteryContextRow = {
  id: string;
  status: DropStatus;
  scheduled_at: string;
};

type RemainingInventoryRow = {
  remaining_inventory: string;
};

export type DropLotteryDecision =
  | { kind: "fcfs" }
  | { kind: "pending"; retryAfterMs: number }
  | { kind: "winner" }
  | { kind: "loser"; retryAfterMs: number };

export type ActiveDropLotteryWindow = {
  dropId: string;
  activationMsHint: number;
};

export class DropLotteryUnavailableError extends Error {
  constructor(message = "Lottery unavailable.") {
    super(message);
    this.name = "DropLotteryUnavailableError";
  }
}

export class DropLotteryServiceError extends Error {
  public readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "DropLotteryServiceError";
    this.cause = cause;
  }
}

export function isLotteryStateUnavailableError(error: unknown): error is DropLotteryUnavailableError {
  return error instanceof DropLotteryUnavailableError;
}

type EnsureClosedResult =
  | { status: "not_due"; closeAtMs: number }
  | { status: "already_closed"; closeAtMs: number; cohortSize: number }
  | { status: "closed"; closeAtMs: number; cohortSize: number }
  | { status: "inactive" };

function lotteryBaseKey(dropId: string): string {
  return `drop:${dropId}:lottery`;
}

function lotteryEntriesKey(dropId: string): string {
  return `${lotteryBaseKey(dropId)}:entries`;
}

function lotteryClosedKey(dropId: string): string {
  return `${lotteryBaseKey(dropId)}:closed`;
}

function lotteryCohortSizeKey(dropId: string): string {
  return `${lotteryBaseKey(dropId)}:cohort_size`;
}

function lotteryActivationMsKey(dropId: string): string {
  return `${lotteryBaseKey(dropId)}:activated_at_ms`;
}

function lotteryWinnerKey(dropId: string, userId: string): string {
  return `${lotteryBaseKey(dropId)}:winner:${userId}`;
}

function resolveLotterySecret(): Buffer {
  const raw = process.env.SERVER_LOTTERY_KEY?.trim();
  if (!raw) {
    throw new DropLotteryUnavailableError("SERVER_LOTTERY_KEY is not configured.");
  }

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  return Buffer.from(raw, "utf8");
}

function computeActivationMsHint(scheduledAtIso: string): number {
  const scheduledAtMs = Date.parse(scheduledAtIso);
  if (Number.isFinite(scheduledAtMs)) {
    return scheduledAtMs;
  }

  return Date.now();
}

function computeLotteryCloseAtMs(activatedAtMs: number): number {
  return activatedAtMs + WAITING_ROOM_WINDOW_MS + WAITING_ROOM_CLOSE_GRACE_MS;
}

function computeLotteryWindowEndMs(activatedAtMs: number): number {
  return activatedAtMs + WAITING_ROOM_WINDOW_MS;
}

function normalizeRetryAfterMs(value: number): number {
  return Math.max(Math.trunc(value), 0);
}

function computeCohortSize(remainingInventory: number): number {
  const safeRemaining = Math.max(Math.trunc(remainingInventory), 0);
  const buffer = Math.min(5, Math.floor(safeRemaining * 0.2));
  return safeRemaining + buffer;
}

function computeLotteryScore(input: { dropId: string; userId: string }): string {
  const key = resolveLotterySecret();
  const entryId = randomUUID();
  const entryTsBucket = Math.floor(Date.now() / 100);
  const digest = createHmac("sha256", key)
    .update(`${input.dropId}|${input.userId}|${entryId}|${entryTsBucket}`)
    .digest("hex");

  const score53BitsHex = digest.slice(0, 13);
  const parsed = Number.parseInt(score53BitsHex, 16);
  return Number.isFinite(parsed) ? String(parsed) : "0";
}

function isRedisStateUnavailableError(error: unknown): boolean {
  const typed = error as { code?: string; message?: string };
  const code = (typed.code ?? "").toUpperCase();
  const message = (typed.message ?? "").toLowerCase();

  if (code.length > 0) {
    const transientCodes = new Set([
      "ECONNREFUSED",
      "ECONNRESET",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "ENOTFOUND",
      "ETIMEDOUT",
      "EAI_AGAIN"
    ]);
    if (transientCodes.has(code)) {
      return true;
    }
  }

  return (
    message.includes("redis") &&
    (message.includes("not configured") ||
      message.includes("connection is closed") ||
      message.includes("max retries per request") ||
      message.includes("failed to refresh slots cache") ||
      message.includes("read only") ||
      message.includes("noauth") ||
      message.includes("clusterdown"))
  );
}

async function withLotteryStateGuard<T>(operation: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof DropLotteryUnavailableError || error instanceof DropLotteryServiceError) {
      throw error;
    }

    if (isRedisStateUnavailableError(error)) {
      throw new DropLotteryUnavailableError(`Lottery state unavailable (${operation}).`);
    }

    throw new DropLotteryServiceError(`Lottery operation failed (${operation}).`, error);
  }
}

async function fetchDropLotteryContext(dropId: string): Promise<DropLotteryContextRow | null> {
  const result = await query<DropLotteryContextRow>(
    `SELECT id, status, scheduled_at
     FROM drops
     WHERE id = $1
     LIMIT 1`,
    [dropId]
  );

  if (result.rowCount !== 1) {
    return null;
  }

  return result.rows[0];
}

async function fetchRemainingInventory(dropId: string): Promise<number> {
  const result = await query<RemainingInventoryRow>(
    `SELECT COALESCE(SUM(remaining_inventory), 0)::BIGINT AS remaining_inventory
     FROM drop_packs
     WHERE drop_id = $1`,
    [dropId]
  );

  return Number(result.rows[0]?.remaining_inventory ?? "0");
}

async function readOrInitializeActivationMs(dropId: string, activationMsHint: number): Promise<number> {
  if (!isRedisConfigured()) {
    throw new DropLotteryUnavailableError("Redis is not configured for lottery admission.");
  }

  const client = getRedisClient();
  const key = lotteryActivationMsKey(dropId);

  await withLotteryStateGuard("activation_ms:set", () =>
    client.set(key, String(activationMsHint), "PX", LOTTERY_STATE_TTL_MS, "NX")
  );

  const stored = await withLotteryStateGuard("activation_ms:get", () => client.get(key));
  if (stored === null) {
    throw new DropLotteryUnavailableError("Lottery activation state is unavailable.");
  }

  const parsed = Number(stored);
  if (!Number.isFinite(parsed)) {
    throw new DropLotteryServiceError("Lottery activation state is invalid.");
  }

  return parsed;
}

async function isLotteryClosed(dropId: string): Promise<boolean> {
  const raw = await withLotteryStateGuard("closed_flag:get", () => getRedisClient().get(lotteryClosedKey(dropId)));
  return raw === "1";
}

async function claimLotteryOutcome(input: {
  dropId: string;
  userId: string;
}): Promise<"pending" | "winner" | "loser"> {
  const decision = await withLotteryStateGuard("claim:eval", () =>
    getRedisClient().eval(
      CLAIM_LOTTERY_SCRIPT,
      4,
      lotteryEntriesKey(input.dropId),
      lotteryClosedKey(input.dropId),
      lotteryCohortSizeKey(input.dropId),
      lotteryWinnerKey(input.dropId, input.userId),
      input.userId,
      computeLotteryScore({ dropId: input.dropId, userId: input.userId }),
      String(WINNER_PRIORITY_TTL_MS),
      String(LOTTERY_STATE_TTL_MS)
    )
  );

  const normalized = Array.isArray(decision) ? String(decision[0] ?? "") : String(decision ?? "");
  if (normalized === "winner" || normalized === "loser" || normalized === "pending") {
    return normalized;
  }

  throw new DropLotteryServiceError("Lottery claim script returned an invalid decision.");
}

export async function listActiveDropLotteryWindows(): Promise<ActiveDropLotteryWindow[]> {
  const result = await query<{ id: string; scheduled_at: string }>(
    `SELECT id, scheduled_at
     FROM drops
     WHERE status = 'active'`
  );

  return result.rows.map((row) => ({
    dropId: row.id,
    activationMsHint: computeActivationMsHint(row.scheduled_at)
  }));
}

export async function initializeDropLotteryActivation(dropId: string, activatedAtMs = Date.now()): Promise<void> {
  if (!isRedisConfigured()) {
    return;
  }

  await withLotteryStateGuard("activation_ms:init", () =>
    getRedisClient().set(lotteryActivationMsKey(dropId), String(activatedAtMs), "PX", LOTTERY_STATE_TTL_MS, "NX")
  );
}

// Test-only helper. Forces activation_ms and clears per-drop lottery state so a
// fresh waiting-room window starts now. Do not call from production code paths
// — `initializeDropLotteryActivation` is the production entry point and uses NX.
export async function resetDropLotteryWindowForTest(
  dropId: string,
  activatedAtMs: number
): Promise<void> {
  if (!isRedisConfigured()) {
    return;
  }

  const client = getRedisClient();
  await withLotteryStateGuard("reset_window_for_test", async () => {
    const tx = client.multi();
    tx.del(lotteryEntriesKey(dropId));
    tx.del(lotteryClosedKey(dropId));
    tx.del(lotteryCohortSizeKey(dropId));
    tx.set(lotteryActivationMsKey(dropId), String(activatedAtMs), "PX", LOTTERY_STATE_TTL_MS);
    await tx.exec();
  });
}

export type DropLotteryStateSnapshot = {
  activationMs: number | null;
  closed: boolean;
  cohortSize: number | null;
  entryCount: number;
};

// Test-only read-only helper. Returns the per-drop lottery state so harnesses
// can verify what the shared Redis actually contains without duplicating key
// builders (SSOT: key builders remain private to this module).
export async function inspectDropLotteryStateForTest(
  dropId: string
): Promise<DropLotteryStateSnapshot> {
  if (!isRedisConfigured()) {
    return { activationMs: null, closed: false, cohortSize: null, entryCount: 0 };
  }

  const client = getRedisClient();
  const [activationRaw, closedRaw, cohortRaw, entryCount] = await Promise.all([
    client.get(lotteryActivationMsKey(dropId)),
    client.get(lotteryClosedKey(dropId)),
    client.get(lotteryCohortSizeKey(dropId)),
    client.zcard(lotteryEntriesKey(dropId))
  ]);

  const parsedActivation = activationRaw !== null ? Number(activationRaw) : null;
  const parsedCohort = cohortRaw !== null ? Number(cohortRaw) : null;

  return {
    activationMs: parsedActivation !== null && Number.isFinite(parsedActivation) ? parsedActivation : null,
    closed: closedRaw === "1",
    cohortSize: parsedCohort !== null && Number.isFinite(parsedCohort) ? parsedCohort : null,
    entryCount
  };
}

export async function ensureDropLotteryClosedIfDue(input: {
  dropId: string;
  activationMsHint?: number;
  nowMs?: number;
}): Promise<EnsureClosedResult> {
  if (!isRedisConfigured()) {
    throw new DropLotteryUnavailableError("Redis is not configured for lottery admission.");
  }

  const context = await fetchDropLotteryContext(input.dropId);
  if (!context || context.status !== "active") {
    return { status: "inactive" };
  }

  const activationMs = await readOrInitializeActivationMs(
    input.dropId,
    input.activationMsHint ?? computeActivationMsHint(context.scheduled_at)
  );
  const closeAtMs = computeLotteryCloseAtMs(activationMs);
  const nowMs = input.nowMs ?? Date.now();

  if (nowMs < closeAtMs) {
    return { status: "not_due", closeAtMs };
  }

  const client = getRedisClient();
  if (await isLotteryClosed(input.dropId)) {
    const cohortRaw = await withLotteryStateGuard("cohort_size:get", () => client.get(lotteryCohortSizeKey(input.dropId)));
    if (cohortRaw === null) {
      throw new DropLotteryUnavailableError("Lottery cohort state is unavailable.");
    }
    const parsedCohortSize = Number(cohortRaw);
    if (!Number.isFinite(parsedCohortSize) || parsedCohortSize < 0) {
      throw new DropLotteryServiceError("Lottery cohort state is invalid.");
    }
    return {
      status: "already_closed",
      closeAtMs,
      cohortSize: parsedCohortSize
    };
  }

  const remainingInventory = await fetchRemainingInventory(input.dropId);
  const cohortSize = computeCohortSize(remainingInventory);

  const tx = client.multi();
  tx.set(lotteryClosedKey(input.dropId), "1", "PX", LOTTERY_STATE_TTL_MS);
  tx.set(lotteryCohortSizeKey(input.dropId), String(cohortSize), "PX", LOTTERY_STATE_TTL_MS);
  tx.pexpire(lotteryEntriesKey(input.dropId), LOTTERY_STATE_TTL_MS);
  tx.pexpire(lotteryActivationMsKey(input.dropId), LOTTERY_STATE_TTL_MS);
  await withLotteryStateGuard("close_lottery:exec", () => tx.exec());

  return { status: "closed", closeAtMs, cohortSize };
}

export async function evaluateDropLotteryAdmission(input: {
  dropId: string;
  userId: string;
  nowMs?: number;
}): Promise<DropLotteryDecision> {
  if (!isRedisConfigured()) {
    throw new DropLotteryUnavailableError("Redis is not configured for lottery admission.");
  }

  const context = await fetchDropLotteryContext(input.dropId);
  if (!context || context.status !== "active") {
    return { kind: "fcfs" };
  }

  const nowMs = input.nowMs ?? Date.now();
  const activationMs = await readOrInitializeActivationMs(input.dropId, computeActivationMsHint(context.scheduled_at));
  const closeAtMs = computeLotteryCloseAtMs(activationMs);
  const windowEndMs = computeLotteryWindowEndMs(activationMs);

  const client = getRedisClient();
  const winnerAlreadyGranted = await withLotteryStateGuard("winner_flag:get", () =>
    client.get(lotteryWinnerKey(input.dropId, input.userId))
  );
  if (winnerAlreadyGranted === "1") {
    return { kind: "winner" };
  }

  const participantScore = await withLotteryStateGuard("participant:zscore", () =>
    client.zscore(lotteryEntriesKey(input.dropId), input.userId)
  );
  const userIsParticipant = participantScore !== null;
  if (nowMs >= windowEndMs && !userIsParticipant) {
    if (nowMs >= closeAtMs) {
      await ensureDropLotteryClosedIfDue({
        dropId: input.dropId,
        activationMsHint: activationMs,
        nowMs
      });
    }

    return { kind: "fcfs" };
  }

  if (nowMs >= closeAtMs) {
    await ensureDropLotteryClosedIfDue({
      dropId: input.dropId,
      activationMsHint: activationMs,
      nowMs
    });
  }

  let outcome = await claimLotteryOutcome({
    dropId: input.dropId,
    userId: input.userId
  });

  if (outcome === "pending" && nowMs >= closeAtMs) {
    await ensureDropLotteryClosedIfDue({
      dropId: input.dropId,
      activationMsHint: activationMs,
      nowMs
    });

    outcome = await claimLotteryOutcome({
      dropId: input.dropId,
      userId: input.userId
    });
  }

  if (outcome === "winner") {
    return { kind: "winner" };
  }

  if (outcome === "loser") {
    return {
      kind: "loser",
      retryAfterMs: normalizeRetryAfterMs(windowEndMs - nowMs)
    };
  }

  return {
    kind: "pending",
    retryAfterMs: normalizeRetryAfterMs(closeAtMs - nowMs)
  };
}
