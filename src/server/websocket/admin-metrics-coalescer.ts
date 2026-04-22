import type { Server as IOServer } from "socket.io";
import type { AdminMetricsDeltaEvent } from "../../lib/types";
import {
  ADMIN_METRICS_COALESCING_ENABLED,
  ADMIN_METRICS_COALESCE_MAX_BUFFER,
  ADMIN_METRICS_COALESCE_WINDOW_MS
} from "../config/constants";
import { getIO } from "./io";
import { roomNames } from "./rooms";

type AdminMetricsDeltaInput = {
  rateLimitHitCountDelta?: number;
  rateLimitHitGlobalCountDelta?: number;
  autoRebalanceTriggeredCountDelta?: number;
  finalWindowBidCountDelta?: number;
  openAuctionFlagCountDelta?: number;
  marginIncidentCountDelta?: number;
  persisted?: boolean;
};

type CoalescedDelta = Omit<AdminMetricsDeltaEvent, "emittedAtIso">;

const zeroDelta: CoalescedDelta = {
  rateLimitHitCountDelta: 0,
  rateLimitHitGlobalCountDelta: 0,
  autoRebalanceTriggeredCountDelta: 0,
  finalWindowBidCountDelta: 0,
  openAuctionFlagCountDelta: 0,
  marginIncidentCountDelta: 0,
  persisted: undefined
};

let pendingDelta = { ...zeroDelta };
let pendingEventCount = 0;
let flushTimer: NodeJS.Timeout | null = null;
let flushing = false;

function normalizeDelta(input: AdminMetricsDeltaInput): CoalescedDelta {
  return {
    rateLimitHitCountDelta: Number(input.rateLimitHitCountDelta ?? 0),
    rateLimitHitGlobalCountDelta: Number(input.rateLimitHitGlobalCountDelta ?? 0),
    autoRebalanceTriggeredCountDelta: Number(input.autoRebalanceTriggeredCountDelta ?? 0),
    finalWindowBidCountDelta: Number(input.finalWindowBidCountDelta ?? 0),
    openAuctionFlagCountDelta: Number(input.openAuctionFlagCountDelta ?? 0),
    marginIncidentCountDelta: Number(input.marginIncidentCountDelta ?? 0),
    persisted: input.persisted === true ? true : undefined
  };
}

function hasAnyDelta(delta: CoalescedDelta): boolean {
  return (
    delta.rateLimitHitCountDelta !== 0 ||
    delta.rateLimitHitGlobalCountDelta !== 0 ||
    delta.autoRebalanceTriggeredCountDelta !== 0 ||
    delta.finalWindowBidCountDelta !== 0 ||
    delta.openAuctionFlagCountDelta !== 0 ||
    delta.marginIncidentCountDelta !== 0
  );
}

function emitImmediate(io: IOServer, input: AdminMetricsDeltaInput): void {
  const normalized = normalizeDelta(input);
  if (!hasAnyDelta(normalized)) {
    return;
  }

  io.to(roomNames.adminMetrics()).emit("admin_metrics_delta", {
    ...normalized,
    emittedAtIso: new Date().toISOString()
  } satisfies AdminMetricsDeltaEvent);
}

function scheduleFlush(io: IOServer): void {
  if (flushTimer) {
    return;
  }

  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushCoalesced(io);
  }, ADMIN_METRICS_COALESCE_WINDOW_MS);
}

function mergePending(input: AdminMetricsDeltaInput): void {
  const delta = normalizeDelta(input);
  pendingDelta = {
    rateLimitHitCountDelta: pendingDelta.rateLimitHitCountDelta + delta.rateLimitHitCountDelta,
    rateLimitHitGlobalCountDelta:
      pendingDelta.rateLimitHitGlobalCountDelta + delta.rateLimitHitGlobalCountDelta,
    autoRebalanceTriggeredCountDelta:
      pendingDelta.autoRebalanceTriggeredCountDelta + delta.autoRebalanceTriggeredCountDelta,
    finalWindowBidCountDelta: pendingDelta.finalWindowBidCountDelta + delta.finalWindowBidCountDelta,
    openAuctionFlagCountDelta: pendingDelta.openAuctionFlagCountDelta + delta.openAuctionFlagCountDelta,
    marginIncidentCountDelta: pendingDelta.marginIncidentCountDelta + delta.marginIncidentCountDelta,
    persisted: pendingDelta.persisted === true || delta.persisted === true ? true : undefined
  };
  pendingEventCount += 1;
}

function flushCoalesced(io: IOServer): void {
  if (flushing || !hasAnyDelta(pendingDelta)) {
    pendingDelta = { ...zeroDelta };
    pendingEventCount = 0;
    return;
  }

  flushing = true;
  const payload = {
    ...pendingDelta,
    emittedAtIso: new Date().toISOString()
  } satisfies AdminMetricsDeltaEvent;
  pendingDelta = { ...zeroDelta };
  pendingEventCount = 0;

  try {
    io.to(roomNames.adminMetrics()).emit("admin_metrics_delta", payload);
  } finally {
    flushing = false;
  }
}

export function emitAdminMetricsDeltaWithCoalescing(io: IOServer, input: AdminMetricsDeltaInput): void {
  if (!ADMIN_METRICS_COALESCING_ENABLED) {
    emitImmediate(io, input);
    return;
  }

  mergePending(input);
  if (!hasAnyDelta(pendingDelta)) {
    return;
  }

  if (pendingEventCount >= ADMIN_METRICS_COALESCE_MAX_BUFFER) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flushCoalesced(io);
    return;
  }

  scheduleFlush(io);
}

export function emitAdminMetricsDeltaFireAndForget(input: AdminMetricsDeltaInput): void {
  try {
    const io = getIO();
    emitAdminMetricsDeltaWithCoalescing(io, input);
  } catch (_error) {
    // Socket server may be unavailable in tests/script contexts.
  }
}

export async function flushAdminMetricsCoalescer(io?: IOServer): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  if (!io) {
    pendingDelta = { ...zeroDelta };
    pendingEventCount = 0;
    return;
  }

  flushCoalesced(io);
}
