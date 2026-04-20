import type { QueryResult, QueryResultRow } from "pg";
import { query } from "../db/pool";
import { emitAdminMetricsDeltaFireAndForget } from "../websocket/admin-metrics-coalescer";

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
};

export type SecurityEventInput = {
  eventType: string;
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
    emitAdminMetricsDeltaFireAndForget({ rateLimitHitCountDelta: 1 });
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
