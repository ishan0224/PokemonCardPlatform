import type { QueryResult, QueryResultRow } from "pg";
import { query } from "../db/pool";
import { emitAdminMetricsDeltaFireAndForget } from "../websocket/admin-metrics-coalescer";

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
};

export type SecurityEventType =
  | "rate_limit_hit"
  | "lottery_loss"
  | "lottery_win"
  | "lottery_unavailable"
  | "purchase_failed"
  | "fairness_verification_run"
  | "margin_incident"
  | "margin_alert"
  | "margin_alert_dedup_unavailable"
  | "auto_rebalance_triggered"
  | "auto_rebalance_skipped"
  | "final_window_bid";

export type SecurityEventInput = {
  eventType: SecurityEventType;
  userId?: string | null;
  ip?: string | null;
  requestKey?: string | null;
  evidence?: Record<string, unknown> | null;
};

export async function writeSecurityEvent(
  input: SecurityEventInput,
  dbClient?: Queryable
): Promise<void> {
  const runner = dbClient
    ? (text: string, params: unknown[]) => dbClient.query(text, params)
    : (text: string, params: unknown[]) => query(text, params);

  await runner(
    `INSERT INTO security_events (event_type, user_id, ip, request_key, evidence_json)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      input.eventType,
      input.userId ?? null,
      input.ip ?? null,
      input.requestKey ?? null,
      JSON.stringify(input.evidence ?? null)
    ]
  );

  if (input.eventType === "rate_limit_hit") {
    const scope = input.evidence?.scope;
    emitAdminMetricsDeltaFireAndForget({
      rateLimitHitCountDelta: 1,
      rateLimitHitGlobalCountDelta: scope === "global" ? 1 : 0
    });
  } else if (input.eventType === "auto_rebalance_triggered") {
    emitAdminMetricsDeltaFireAndForget({
      autoRebalanceTriggeredCountDelta: 1,
      persisted: true
    });
  } else if (input.eventType === "final_window_bid") {
    emitAdminMetricsDeltaFireAndForget({
      finalWindowBidCountDelta: 1,
      persisted: true
    });
  }
}

export function writeSecurityEventFireAndForget(
  input: SecurityEventInput,
  dbClient?: Queryable
): void {
  void writeSecurityEvent(input, dbClient).catch((error) => {
    const typed = error as { message?: string };
    console.warn(`[security-events] failed to write ${input.eventType}: ${typed.message ?? "unknown error"}`);
  });
}
