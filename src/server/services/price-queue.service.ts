import { query, withTransaction } from "../db/pool";

export type PriceUpdateJobStatus = "pending" | "running" | "completed" | "failed";

export type PriceUpdateJobPayload = {
  pokemonCardIds: string[];
  bucketStartMs: number;
};

export type PriceUpdateJob = {
  id: string;
  jobKey: string;
  status: PriceUpdateJobStatus;
  runAt: string;
  attempts: number;
  maxAttempts: number;
  lockedAt: string | null;
  lockedBy: string | null;
  payload: PriceUpdateJobPayload;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type PriceUpdateJobRow = {
  id: string;
  job_key: string;
  status: PriceUpdateJobStatus;
  run_at: string;
  attempts: number;
  max_attempts: number;
  locked_at: string | null;
  locked_by: string | null;
  payload: unknown;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type EnqueueInput = {
  jobKey: string;
  runAt: string;
  maxAttempts: number;
  payload: PriceUpdateJobPayload;
};

export type EnqueuePriceUpdateJobsResult = {
  enqueued: number;
  duplicates: number;
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function parsePayload(value: unknown): PriceUpdateJobPayload {
  if (!value || typeof value !== "object") {
    return { pokemonCardIds: [], bucketStartMs: 0 };
  }

  const raw = value as Partial<PriceUpdateJobPayload>;
  return {
    pokemonCardIds: asStringArray(raw.pokemonCardIds),
    bucketStartMs: Number.isFinite(raw.bucketStartMs) ? Math.trunc(raw.bucketStartMs as number) : 0
  };
}

function mapRow(row: PriceUpdateJobRow): PriceUpdateJob {
  return {
    id: row.id,
    jobKey: row.job_key,
    status: row.status,
    runAt: row.run_at,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lockedAt: row.locked_at,
    lockedBy: row.locked_by,
    payload: parsePayload(row.payload),
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  };
}

export async function enqueuePriceUpdateJobs(inputs: EnqueueInput[]): Promise<EnqueuePriceUpdateJobsResult> {
  if (inputs.length === 0) {
    return {
      enqueued: 0,
      duplicates: 0
    };
  }

  return withTransaction(async (client) => {
    let enqueued = 0;
    let duplicates = 0;

    for (const input of inputs) {
      const result = await client.query(
        `INSERT INTO price_update_jobs (job_key, status, run_at, attempts, max_attempts, payload, created_at, updated_at)
         VALUES ($1, 'pending', $2, 0, $3, $4::jsonb, now(), now())
         ON CONFLICT (job_key) DO NOTHING`,
        [input.jobKey, input.runAt, input.maxAttempts, JSON.stringify(input.payload)]
      );

      if (result.rowCount === 1) {
        enqueued += 1;
      } else {
        duplicates += 1;
      }
    }

    return {
      enqueued,
      duplicates
    };
  });
}

export async function claimNextPriceUpdateJob(workerId: string): Promise<PriceUpdateJob | null> {
  return withTransaction(async (client) => {
    const claimed = await client.query<PriceUpdateJobRow>(
      `WITH next_job AS (
         SELECT id
         FROM price_update_jobs
         WHERE status = 'pending'
           AND run_at <= now()
         ORDER BY run_at ASC, created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE price_update_jobs j
       SET status = 'running',
           locked_at = now(),
           locked_by = $1,
           updated_at = now()
       FROM next_job
       WHERE j.id = next_job.id
       RETURNING j.id,
                 j.job_key,
                 j.status,
                 j.run_at,
                 j.attempts,
                 j.max_attempts,
                 j.locked_at,
                 j.locked_by,
                 j.payload,
                 j.last_error,
                 j.created_at,
                 j.updated_at,
                 j.completed_at`,
      [workerId]
    );

    if (claimed.rowCount !== 1) {
      return null;
    }

    return mapRow(claimed.rows[0]);
  });
}

export async function markPriceUpdateJobCompleted(jobId: string): Promise<void> {
  await query(
    `UPDATE price_update_jobs
     SET status = 'completed',
         completed_at = now(),
         locked_at = NULL,
         locked_by = NULL,
         updated_at = now()
     WHERE id = $1`,
    [jobId]
  );
}

export async function markPriceUpdateJobRetryOrFailed(input: {
  jobId: string;
  attempts: number;
  maxAttempts: number;
  errorMessage: string;
  retryDelayMs: number;
}): Promise<PriceUpdateJobStatus> {
  const nextAttempts = input.attempts + 1;

  if (nextAttempts >= input.maxAttempts) {
    await query(
      `UPDATE price_update_jobs
       SET status = 'failed',
           attempts = $2,
           last_error = $3,
           locked_at = NULL,
           locked_by = NULL,
           updated_at = now()
       WHERE id = $1`,
      [input.jobId, nextAttempts, input.errorMessage]
    );

    return "failed";
  }

  await query(
    `UPDATE price_update_jobs
     SET status = 'pending',
         attempts = $2,
         run_at = now() + ($3::double precision * interval '1 millisecond'),
         last_error = $4,
         locked_at = NULL,
         locked_by = NULL,
         updated_at = now()
     WHERE id = $1`,
    [input.jobId, nextAttempts, input.retryDelayMs, input.errorMessage]
  );

  return "pending";
}

export async function recoverStaleRunningPriceUpdateJobs(lockTimeoutMs: number): Promise<number> {
  const recovered = await query<{ id: string }>(
    `UPDATE price_update_jobs
     SET status = 'pending',
         run_at = now(),
         locked_at = NULL,
         locked_by = NULL,
         last_error = COALESCE(last_error, 'Recovered stale running job lock'),
         updated_at = now()
     WHERE status = 'running'
       AND locked_at IS NOT NULL
       AND locked_at < now() - ($1::double precision * interval '1 millisecond')
     RETURNING id`,
    [lockTimeoutMs]
  );

  return recovered.rowCount ?? 0;
}
