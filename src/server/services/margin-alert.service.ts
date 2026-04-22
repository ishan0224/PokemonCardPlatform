import { createHmac } from "crypto";
import { type PackTier } from "../../lib/types";
import {
  ECONOMICS_ALERT_DEDUP_WINDOW_MS,
  ECONOMICS_ALERT_WEBHOOK_SECRET,
  ECONOMICS_ALERT_WEBHOOK_TIMEOUT_MS,
  ECONOMICS_ALERT_WEBHOOK_URL,
  ECONOMICS_ALERTS_ENABLED
} from "../config/constants";
import { getRedisClient } from "../redis/client";
import { emitAdminMetricsDeltaFireAndForget } from "../websocket/admin-metrics-coalescer";
import { writeSecurityEventFireAndForget } from "./security-event.service";

export type MarginAlertDirection = "below_band" | "above_band";

export type MarginAlertInput = {
  tier: PackTier;
  direction: MarginAlertDirection;
  targetEdgeBps: number;
  observedEdgeBps: number;
  deltaBps: number;
  sampleSize: number;
  windowSeconds: number;
};

type MarginAlertEvidence = {
  tier: PackTier;
  direction: MarginAlertDirection;
  targetEdgeBps: number;
  observedEdgeBps: number;
  deltaBps: number;
  windowSeconds: number;
  sampleSize: number;
};

function buildDedupKey(tier: PackTier, direction: MarginAlertDirection): string {
  return `econ:alert:dedup:${tier}:${direction}`;
}

function normalizeEvidence(input: MarginAlertInput): MarginAlertEvidence {
  return {
    tier: input.tier,
    direction: input.direction,
    targetEdgeBps: Math.trunc(input.targetEdgeBps),
    observedEdgeBps: Math.trunc(input.observedEdgeBps),
    deltaBps: Math.trunc(input.deltaBps),
    windowSeconds: Math.max(Math.trunc(input.windowSeconds), 1),
    sampleSize: Math.max(Math.trunc(input.sampleSize), 0)
  };
}

async function shouldEmitForKey(dedupKey: string): Promise<{ emit: boolean; dedupErrorReason?: string }> {
  try {
    const result = await getRedisClient().set(dedupKey, "1", "PX", ECONOMICS_ALERT_DEDUP_WINDOW_MS, "NX");
    if (result === null) {
      return { emit: false };
    }
    return { emit: true };
  } catch (error) {
    const typed = error as { message?: string };
    return {
      emit: true,
      dedupErrorReason: typed.message ?? "redis_unavailable"
    };
  }
}

async function maybeDispatchWebhook(evidence: MarginAlertEvidence): Promise<void> {
  if (!ECONOMICS_ALERT_WEBHOOK_URL) {
    return;
  }

  if (!ECONOMICS_ALERT_WEBHOOK_SECRET) {
    console.warn("[margin-alert] webhook URL is set but secret is missing; skipping webhook dispatch");
    return;
  }

  const payload = JSON.stringify(evidence);
  const signature = createHmac("sha256", ECONOMICS_ALERT_WEBHOOK_SECRET).update(payload).digest("hex");
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, ECONOMICS_ALERT_WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(ECONOMICS_ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PullVault-Signature": `sha256=${signature}`
      },
      body: payload,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`status=${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function maybeFireMarginAlert(input: MarginAlertInput): Promise<void> {
  if (!ECONOMICS_ALERTS_ENABLED) {
    return;
  }

  const evidence = normalizeEvidence(input);
  const dedupKey = buildDedupKey(evidence.tier, evidence.direction);
  const dedupDecision = await shouldEmitForKey(dedupKey);
  if (!dedupDecision.emit) {
    return;
  }

  if (dedupDecision.dedupErrorReason) {
    writeSecurityEventFireAndForget({
      eventType: "margin_alert_dedup_unavailable",
      evidence: {
        tier: evidence.tier,
        direction: evidence.direction,
        reason: dedupDecision.dedupErrorReason
      }
    });
  }

  writeSecurityEventFireAndForget({
    eventType: "margin_alert",
    evidence
  });
  emitAdminMetricsDeltaFireAndForget({
    marginIncidentCountDelta: 1,
    persisted: true
  });

  try {
    await maybeDispatchWebhook(evidence);
  } catch (error) {
    const typed = error as { message?: string };
    console.warn(`[margin-alert] webhook dispatch failed: ${typed.message ?? "unknown error"}`);
  }
}
