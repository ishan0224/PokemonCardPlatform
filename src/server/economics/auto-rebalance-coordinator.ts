import type { QueryResultRow } from "pg";
import {
  AUTO_REBALANCE_DEBOUNCE_MS,
  AUTO_REBALANCE_DRIFT_SAMPLE_MAX_CARDS,
  AUTO_REBALANCE_DRIFT_THRESHOLD_BPS,
  AUTO_REBALANCE_ENABLED,
  AUTO_REBALANCE_MIN_INTERVAL_MS
} from "../config/constants";
import { query, withTransaction } from "../db/pool";
import type { GenerationVersion } from "../services/pack-generation-version.service";
import { getLatestGenerationVersion } from "../services/pack-generation-version.service";
import type { SecurityEventInput } from "../services/security-event.service";
import { writeSecurityEventFireAndForget } from "../services/security-event.service";
import { computeAnchorDriftBps, selectEligibleCardIdsForDrift, type AnchorDriftResult, type DriftPricePoint } from "./drift-detector";
import { EconomicsRebalanceError, rebalanceEconomics } from "./rebalance";

type AutoRebalanceSkipReason =
  | "drift_below_threshold"
  | "cooldown"
  | "disabled"
  | "lock_contended"
  | "drift_calc_error";

type AutoRebalanceConfig = {
  enabled: boolean;
  driftThresholdBps: number;
  debounceMs: number;
  minIntervalMs: number;
  driftSampleMaxCards: number;
};

type AutoRebalanceCoordinatorDeps = {
  now: () => number;
  setTimeoutFn: (callback: () => void, timeoutMs: number) => NodeJS.Timeout;
  clearTimeoutFn: (timer: NodeJS.Timeout) => void;
  config: AutoRebalanceConfig;
  loadLatestGenerationVersion: () => Promise<GenerationVersion | null>;
  loadCurrentPrices: (cardIds: string[]) => Promise<DriftPricePoint[]>;
  loadLatestRebalanceTimestampMs: () => Promise<number | null>;
  rebalance: () => Promise<{ version: { versionNumber: number; contentHash: string } }>;
  writeSecurityEvent: (input: SecurityEventInput) => void;
};

type AutoRebalanceCoordinatorState = {
  lastEvaluatedAt: number | null;
  lastRebalancedAt: number | null;
  pendingDebounceTimer: NodeJS.Timeout | null;
  lastSkippedEventAtByReason: Partial<Record<AutoRebalanceSkipReason, number>>;
};

const SKIPPED_EVENT_THROTTLE_MS = 60_000;

function defaultConfig(): AutoRebalanceConfig {
  return {
    enabled: AUTO_REBALANCE_ENABLED,
    driftThresholdBps: AUTO_REBALANCE_DRIFT_THRESHOLD_BPS,
    debounceMs: AUTO_REBALANCE_DEBOUNCE_MS,
    minIntervalMs: AUTO_REBALANCE_MIN_INTERVAL_MS,
    driftSampleMaxCards: AUTO_REBALANCE_DRIFT_SAMPLE_MAX_CARDS
  };
}

async function loadLatestGenerationVersionDefault(): Promise<GenerationVersion | null> {
  return withTransaction(async (client) => getLatestGenerationVersion(client));
}

type CardPriceRow = QueryResultRow & {
  id: string;
  rarity_tier: DriftPricePoint["rarityTier"];
  current_price: string;
};

async function loadCurrentPricesDefault(cardIds: string[]): Promise<DriftPricePoint[]> {
  if (cardIds.length === 0) {
    return [];
  }

  const result = await query<CardPriceRow>(
    `SELECT id,
            rarity_tier::text AS rarity_tier,
            current_price::text AS current_price
     FROM pokemon_cards
     WHERE id = ANY($1::uuid[])`,
    [cardIds]
  );

  return result.rows
    .map((row) => ({
      cardId: row.id,
      rarityTier: row.rarity_tier,
      currentPrice: Number(row.current_price)
    }))
    .filter((row) => Number.isFinite(row.currentPrice) && row.currentPrice >= 0);
}

async function loadLatestRebalanceTimestampMsDefault(): Promise<number | null> {
  const result = await query<{ ts_ms: string | null }>(
    `SELECT (EXTRACT(EPOCH FROM MAX(created_at)) * 1000)::BIGINT::text AS ts_ms
     FROM pack_generation_versions`
  );
  const raw = result.rows[0]?.ts_ms;
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function isLockContendedError(error: unknown): boolean {
  if (error instanceof EconomicsRebalanceError && error.code === "REBALANCE_LOCK_CONTENDED") {
    return true;
  }

  const typed = error as { code?: string };
  return typed?.code === "REBALANCE_LOCK_CONTENDED";
}

function createInitialState(): AutoRebalanceCoordinatorState {
  return {
    lastEvaluatedAt: null,
    lastRebalancedAt: null,
    pendingDebounceTimer: null,
    lastSkippedEventAtByReason: {}
  };
}

export function createAutoRebalanceCoordinator(
  dependencies: Partial<AutoRebalanceCoordinatorDeps> = {}
): {
  maybeTriggerAutoRebalance: () => Promise<void>;
  resetForTests: () => void;
} {
  const deps: AutoRebalanceCoordinatorDeps = {
    now: dependencies.now ?? (() => Date.now()),
    setTimeoutFn: dependencies.setTimeoutFn ?? ((callback, timeoutMs) => setTimeout(callback, timeoutMs)),
    clearTimeoutFn: dependencies.clearTimeoutFn ?? ((timer) => clearTimeout(timer)),
    config: dependencies.config ?? defaultConfig(),
    loadLatestGenerationVersion: dependencies.loadLatestGenerationVersion ?? loadLatestGenerationVersionDefault,
    loadCurrentPrices: dependencies.loadCurrentPrices ?? loadCurrentPricesDefault,
    loadLatestRebalanceTimestampMs:
      dependencies.loadLatestRebalanceTimestampMs ?? loadLatestRebalanceTimestampMsDefault,
    rebalance:
      dependencies.rebalance ??
      (() =>
        rebalanceEconomics({
          actorUserId: null,
          lockMode: "try"
        })),
    writeSecurityEvent: dependencies.writeSecurityEvent ?? writeSecurityEventFireAndForget
  };

  const state = createInitialState();

  const emitSkipped = (reason: AutoRebalanceSkipReason, driftBps?: number): void => {
    const nowMs = deps.now();
    const lastLoggedAt = state.lastSkippedEventAtByReason[reason];
    if (lastLoggedAt !== undefined && nowMs - lastLoggedAt < SKIPPED_EVENT_THROTTLE_MS) {
      return;
    }
    state.lastSkippedEventAtByReason[reason] = nowMs;

    const evidence: Record<string, unknown> = { reason };
    if (typeof driftBps === "number" && Number.isFinite(driftBps)) {
      evidence.drift_bps = Math.max(Math.trunc(driftBps), 0);
    }

    deps.writeSecurityEvent({
      eventType: "auto_rebalance_skipped",
      evidence
    });
  };

  const syncLastRebalanceAt = async (): Promise<void> => {
    const latestRebalanceAt = await deps.loadLatestRebalanceTimestampMs();
    if (latestRebalanceAt === null) {
      return;
    }

    if (state.lastRebalancedAt === null || latestRebalanceAt > state.lastRebalancedAt) {
      state.lastRebalancedAt = latestRebalanceAt;
    }
  };

  const cooldownActive = (nowMs: number): boolean => {
    if (state.lastRebalancedAt === null) {
      return false;
    }
    return nowMs - state.lastRebalancedAt < deps.config.minIntervalMs;
  };

  const executeDebouncedRebalance = async (driftResult: AnchorDriftResult): Promise<void> => {
    try {
      await syncLastRebalanceAt();
      if (cooldownActive(deps.now())) {
        emitSkipped("cooldown", driftResult.driftBps);
        return;
      }

      const result = await deps.rebalance();
      state.lastRebalancedAt = deps.now();

      deps.writeSecurityEvent({
        eventType: "auto_rebalance_triggered",
        evidence: {
          drift_bps: Math.max(Math.trunc(driftResult.driftBps), 0),
          sampleSize: driftResult.sampleSize,
          newVersionNumber: result.version.versionNumber,
          contentHash: result.version.contentHash
        }
      });
    } catch (error) {
      if (isLockContendedError(error)) {
        emitSkipped("lock_contended", driftResult.driftBps);
        return;
      }

      emitSkipped("drift_calc_error", driftResult.driftBps);
      const typed = error as { message?: string };
      console.warn(`[auto-rebalance] debounced rebalance failed: ${typed.message ?? "unknown error"}`);
    }
  };

  const maybeTriggerAutoRebalance = async (): Promise<void> => {
    state.lastEvaluatedAt = deps.now();

    if (!deps.config.enabled) {
      emitSkipped("disabled");
      return;
    }

    try {
      await syncLastRebalanceAt();
      if (cooldownActive(deps.now())) {
        emitSkipped("cooldown");
        return;
      }

      const latest = await deps.loadLatestGenerationVersion();
      if (!latest) {
        emitSkipped("drift_calc_error");
        return;
      }

      const sampledCardIds = selectEligibleCardIdsForDrift(
        latest.payload.eligibleCardIdsByTier,
        deps.config.driftSampleMaxCards
      );
      if (sampledCardIds.length === 0) {
        emitSkipped("drift_below_threshold", 0);
        return;
      }

      const currentPrices = await deps.loadCurrentPrices(sampledCardIds);
      const driftResult = computeAnchorDriftBps({
        currentPrices,
        anchorSnapshot: latest.anchorSnapshot,
        eligibleCardIds: latest.payload.eligibleCardIdsByTier
      });

      if (driftResult.sampleSize === 0 || driftResult.driftBps < deps.config.driftThresholdBps) {
        emitSkipped("drift_below_threshold", driftResult.driftBps);
        return;
      }

      if (state.pendingDebounceTimer) {
        return;
      }

      state.pendingDebounceTimer = deps.setTimeoutFn(() => {
        state.pendingDebounceTimer = null;
        void executeDebouncedRebalance(driftResult);
      }, deps.config.debounceMs);
    } catch (error) {
      emitSkipped("drift_calc_error");
      const typed = error as { message?: string };
      console.warn(`[auto-rebalance] drift evaluation failed: ${typed.message ?? "unknown error"}`);
    }
  };

  const resetForTests = (): void => {
    if (state.pendingDebounceTimer) {
      deps.clearTimeoutFn(state.pendingDebounceTimer);
    }

    state.lastEvaluatedAt = null;
    state.lastRebalancedAt = null;
    state.pendingDebounceTimer = null;
    state.lastSkippedEventAtByReason = {};
  };

  return {
    maybeTriggerAutoRebalance,
    resetForTests
  };
}

const defaultAutoRebalanceCoordinator = createAutoRebalanceCoordinator();

export async function maybeTriggerAutoRebalance(): Promise<void> {
  await defaultAutoRebalanceCoordinator.maybeTriggerAutoRebalance();
}

export function resetAutoRebalanceCoordinatorForTests(): void {
  defaultAutoRebalanceCoordinator.resetForTests();
}
