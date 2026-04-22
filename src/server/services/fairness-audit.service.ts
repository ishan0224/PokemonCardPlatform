import type { QueryResult, QueryResultRow } from "pg";
import type { FairnessAuditResult, FairnessAuditRunSource, PackTier, RarityTier } from "../../lib/types";
import { PACK_TIERS, RARITY_TIERS } from "../../lib/types";
import { withTransaction, query } from "../db/pool";
import { ApiRouteError } from "../http/api";
import { getGenerationVersionById } from "./pack-generation-version.service";

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
};

type VersionPackMixRow = {
  generation_version_id: string;
  tier: string;
  pack_count: string;
};

type ObservedRow = {
  rarity_tier: RarityTier;
  n: string;
};

type CountRow = {
  n: string;
};

type FairnessAuditRow = {
  id: string;
  window_start: Date;
  window_end: Date;
  observed_counts_json: unknown;
  expected_counts_json: unknown;
  test_statistic: string;
  degrees_of_freedom: number;
  p_value: string;
  monte_carlo_n_samples: number | null;
  monte_carlo_extreme_count: number | null;
  run_source: FairnessAuditRunSource;
  ran_at: Date;
};

const DEFAULT_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 31;
const NIGHTLY_MONTE_CARLO_SAMPLES = 100_000;
const ON_DEMAND_MONTE_CARLO_SAMPLES = 10_000;

type FairnessAuditComputation = {
  observedCounts: Record<RarityTier, number>;
  expectedCounts: Record<RarityTier, number>;
  testStatistic: number;
  degreesOfFreedom: number;
  pValue: number;
  sampleSize: number;
  monteCarloApplied: boolean;
  monteCarloSamples: number | null;
  monteCarloExtremeCount: number | null;
};

function parseRarityCounts(raw: unknown, field: string): Record<RarityTier, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${field} must be a JSON object.`);
  }

  const source = raw as Record<string, unknown>;
  const parsed = {} as Record<RarityTier, number>;
  for (const rarity of RARITY_TIERS) {
    const value = source[rarity];
    if (typeof value !== "number" || Number.isNaN(value)) {
      throw new Error(`${field}.${rarity} must be a number.`);
    }
    parsed[rarity] = value;
  }

  return parsed;
}

function normalizeTier(raw: string): PackTier | null {
  return PACK_TIERS.includes(raw as PackTier) ? (raw as PackTier) : null;
}

function buildZeroCounts(): Record<RarityTier, number> {
  return {
    common: 0,
    uncommon: 0,
    rare: 0,
    holo_rare: 0,
    ultra_rare: 0,
    chase: 0
  };
}

function getWindowBounds(days: number, now: Date = new Date()): { windowStart: Date; windowEnd: Date } {
  const windowEnd = now;
  const windowStart = new Date(windowEnd.getTime() - days * 24 * 60 * 60 * 1000);
  return { windowStart, windowEnd };
}

export function parseFairnessAuditWindowDays(raw: string | null): number {
  if (!raw || raw.trim().length === 0) {
    return DEFAULT_WINDOW_DAYS;
  }

  const normalized = raw.trim().toLowerCase();
  const match = normalized.match(/^(\d+)d$/);
  if (!match) {
    throw new ApiRouteError("window must be in Nd format (for example, 7d).", 400, "INVALID_WINDOW");
  }

  const parsed = Number(match[1]);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_WINDOW_DAYS) {
    throw new ApiRouteError(
      `window must be between 1d and ${MAX_WINDOW_DAYS}d.`,
      400,
      "INVALID_WINDOW"
    );
  }

  return parsed;
}

function isSparseExpectedBucket(expectedCounts: Record<RarityTier, number>): boolean {
  return RARITY_TIERS.some((rarity) => expectedCounts[rarity] > 0 && expectedCounts[rarity] < 5);
}

function buildChiSquared(
  observedCounts: Record<RarityTier, number>,
  expectedCounts: Record<RarityTier, number>
): { statistic: number; degreesOfFreedom: number } {
  let statistic = 0;
  let nonZeroExpectedBuckets = 0;

  for (const rarity of RARITY_TIERS) {
    const expected = expectedCounts[rarity];
    if (expected <= 0) {
      continue;
    }

    nonZeroExpectedBuckets += 1;
    const observed = observedCounts[rarity];
    const delta = observed - expected;
    statistic += (delta * delta) / expected;
  }

  const degreesOfFreedom = Math.max(nonZeroExpectedBuckets - 1, 0);
  return { statistic, degreesOfFreedom };
}

function logGamma(value: number): number {
  const coefficients = [
    76.18009172947146,
    -86.50532032941677,
    24.01409824083091,
    -1.231739572450155,
    0.001208650973866179,
    -0.000005395239384953
  ];

  let x = value;
  let y = value;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let series = 1.000000000190015;
  for (const coefficient of coefficients) {
    y += 1;
    series += coefficient / y;
  }

  return -tmp + Math.log(2.5066282746310005 * series / x);
}

function regularizedGammaP(shape: number, x: number): number {
  if (x <= 0) {
    return 0;
  }

  if (x < shape + 1) {
    let ap = shape;
    let sum = 1 / shape;
    let delta = sum;

    for (let n = 1; n <= 200; n += 1) {
      ap += 1;
      delta *= x / ap;
      sum += delta;
      if (Math.abs(delta) < Math.abs(sum) * 1e-12) {
        break;
      }
    }

    return sum * Math.exp(-x + shape * Math.log(x) - logGamma(shape));
  }

  return 1 - regularizedGammaQ(shape, x);
}

function regularizedGammaQ(shape: number, x: number): number {
  const tiny = 1e-30;
  let b = x + 1 - shape;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;

  for (let i = 1; i <= 200; i += 1) {
    const an = -i * (i - shape);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) {
      d = tiny;
    }
    c = b + an / c;
    if (Math.abs(c) < tiny) {
      c = tiny;
    }
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-12) {
      break;
    }
  }

  return Math.exp(-x + shape * Math.log(x) - logGamma(shape)) * h;
}

function chiSquaredSurvivalPValue(statistic: number, degreesOfFreedom: number): number {
  if (degreesOfFreedom <= 0 || statistic <= 0) {
    return 1;
  }
  const shape = degreesOfFreedom / 2;
  const x = statistic / 2;
  const lowerCdf = regularizedGammaP(shape, x);
  return Math.max(0, Math.min(1, 1 - lowerCdf));
}

function sampleMultinomialCounts(totalDraws: number, cumulativeProbabilities: number[]): number[] {
  const counts = Array.from({ length: cumulativeProbabilities.length }, () => 0);
  for (let draw = 0; draw < totalDraws; draw += 1) {
    const randomValue = Math.random();
    let bucket = 0;
    while (bucket < cumulativeProbabilities.length - 1 && randomValue > cumulativeProbabilities[bucket]) {
      bucket += 1;
    }
    counts[bucket] += 1;
  }
  return counts;
}

function runMonteCarloCalibration(input: {
  observedStatistic: number;
  observedTotalCards: number;
  expectedCounts: Record<RarityTier, number>;
  samples: number;
}): { samples: number; extremeCount: number } {
  if (input.observedTotalCards <= 0 || input.samples <= 0) {
    return { samples: 0, extremeCount: 0 };
  }

  const expectedArray = RARITY_TIERS.map((rarity) => input.expectedCounts[rarity]);
  const expectedTotal = expectedArray.reduce((sum, entry) => sum + entry, 0);
  if (expectedTotal <= 0) {
    return { samples: 0, extremeCount: 0 };
  }

  const cumulativeProbabilities: number[] = [];
  let running = 0;
  for (const expected of expectedArray) {
    running += expected / expectedTotal;
    cumulativeProbabilities.push(running);
  }
  cumulativeProbabilities[cumulativeProbabilities.length - 1] = 1;

  let extremeCount = 0;
  for (let sample = 0; sample < input.samples; sample += 1) {
    const simulatedCounts = sampleMultinomialCounts(input.observedTotalCards, cumulativeProbabilities);

    let statistic = 0;
    for (let index = 0; index < expectedArray.length; index += 1) {
      const expected = expectedArray[index];
      if (expected <= 0) {
        continue;
      }
      const delta = simulatedCounts[index] - expected;
      statistic += (delta * delta) / expected;
    }

    if (statistic >= input.observedStatistic) {
      extremeCount += 1;
    }
  }

  return {
    samples: input.samples,
    extremeCount
  };
}

async function fetchObservedCounts(
  client: Queryable,
  windowStart: Date,
  windowEnd: Date
): Promise<{ counts: Record<RarityTier, number>; totalCards: number; sampleSize: number }> {
  // pg Client is single-stream — queries on the same client must be serialised.
  const observedResult = await client.query<ObservedRow>(
    `SELECT c.rarity_tier::text AS rarity_tier, COUNT(*)::BIGINT AS n
     FROM cards c
     JOIN packs p ON p.id = c.pack_id
     JOIN pack_commitments pc ON pc.pack_id = p.id
     WHERE p.purchased_at >= $1
       AND p.purchased_at < $2
     GROUP BY c.rarity_tier`,
    [windowStart, windowEnd]
  );
  const sampleResult = await client.query<CountRow>(
    `SELECT COUNT(DISTINCT p.id)::BIGINT AS n
     FROM packs p
     JOIN pack_commitments pc ON pc.pack_id = p.id
     WHERE p.purchased_at >= $1
       AND p.purchased_at < $2`,
    [windowStart, windowEnd]
  );

  const counts = buildZeroCounts();
  let totalCards = 0;
  for (const row of observedResult.rows) {
    const count = Number(row.n);
    counts[row.rarity_tier] = count;
    totalCards += count;
  }

  return {
    counts,
    totalCards,
    sampleSize: Number(sampleResult.rows[0]?.n ?? 0)
  };
}

function buildPerPackExpectedRarityCounts(input: {
  slots: Array<Array<{ rarity: RarityTier; weight: number }>>;
}): Record<RarityTier, number> {
  const perPack = buildZeroCounts();

  for (const slot of input.slots) {
    const slotWeight = slot.reduce((sum, entry) => sum + entry.weight, 0);
    if (slotWeight <= 0) {
      continue;
    }

    for (const entry of slot) {
      perPack[entry.rarity] += entry.weight / slotWeight;
    }
  }

  return perPack;
}

async function buildExpectedCounts(
  client: Queryable,
  windowStart: Date,
  windowEnd: Date
): Promise<Record<RarityTier, number>> {
  const mixResult = await client.query<VersionPackMixRow>(
    `SELECT p.generation_version_id::text AS generation_version_id,
            p.tier::text AS tier,
            COUNT(*)::BIGINT AS pack_count
     FROM packs p
     JOIN pack_commitments pc ON pc.pack_id = p.id
     WHERE p.purchased_at >= $1
       AND p.purchased_at < $2
       AND p.generation_version_id IS NOT NULL
     GROUP BY p.generation_version_id, p.tier`,
    [windowStart, windowEnd]
  );

  const expected = buildZeroCounts();
  const versionCache = new Map<string, Awaited<ReturnType<typeof getGenerationVersionById>>>();

  for (const row of mixResult.rows) {
    const tier = normalizeTier(row.tier);
    if (!tier) {
      continue;
    }

    const packCount = Number(row.pack_count);
    if (packCount <= 0) {
      continue;
    }

    let generationVersion = versionCache.get(row.generation_version_id) ?? null;
    if (!generationVersion) {
      generationVersion = await getGenerationVersionById(client, row.generation_version_id);
      versionCache.set(row.generation_version_id, generationVersion);
    }
    if (!generationVersion) {
      continue;
    }

    const tierWeights = generationVersion.payload.weightsByTier[tier];
    const perPackExpected = buildPerPackExpectedRarityCounts({ slots: tierWeights.slots });
    for (const rarity of RARITY_TIERS) {
      expected[rarity] += perPackExpected[rarity] * packCount;
    }
  }

  return expected;
}

async function persistAuditResult(
  client: Queryable,
  input: {
    windowStart: Date;
    windowEnd: Date;
    runSource: FairnessAuditRunSource;
    computed: FairnessAuditComputation;
  }
): Promise<FairnessAuditRow> {
  const inserted = await client.query<FairnessAuditRow>(
    `INSERT INTO fairness_audit_results (
       window_start,
       window_end,
       observed_counts_json,
       expected_counts_json,
       test_statistic,
       degrees_of_freedom,
       p_value,
       monte_carlo_n_samples,
       monte_carlo_extreme_count,
       run_source
     )
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8, $9, $10)
     RETURNING
       id,
       window_start,
       window_end,
       observed_counts_json,
       expected_counts_json,
       test_statistic::text,
       degrees_of_freedom,
       p_value::text,
       monte_carlo_n_samples,
       monte_carlo_extreme_count,
       run_source,
       ran_at`,
    [
      input.windowStart,
      input.windowEnd,
      JSON.stringify(input.computed.observedCounts),
      JSON.stringify(input.computed.expectedCounts),
      input.computed.testStatistic,
      input.computed.degreesOfFreedom,
      input.computed.pValue,
      input.computed.monteCarloSamples,
      input.computed.monteCarloExtremeCount,
      input.runSource
    ]
  );

  return inserted.rows[0];
}

function mapAuditRow(
  row: FairnessAuditRow,
  sampleSize: number
): FairnessAuditResult {
  const observedCounts = parseRarityCounts(row.observed_counts_json, "observed_counts_json");
  const expectedCounts = parseRarityCounts(row.expected_counts_json, "expected_counts_json");

  return {
    id: row.id,
    windowStartIso: new Date(row.window_start).toISOString(),
    windowEndIso: new Date(row.window_end).toISOString(),
    observedCounts,
    expectedCounts,
    testStatistic: Number(row.test_statistic),
    degreesOfFreedom: row.degrees_of_freedom,
    pValue: Number(row.p_value),
    runSource: row.run_source,
    ranAtIso: new Date(row.ran_at).toISOString(),
    sampleSize,
    monteCarloApplied:
      typeof row.monte_carlo_n_samples === "number" &&
      row.monte_carlo_n_samples > 0 &&
      typeof row.monte_carlo_extreme_count === "number",
    monteCarloSamples: row.monte_carlo_n_samples,
    monteCarloExtremeCount: row.monte_carlo_extreme_count
  };
}

async function countSampleSizeForWindow(client: Queryable, windowStart: Date, windowEnd: Date): Promise<number> {
  const sampleResult = await client.query<CountRow>(
    `SELECT COUNT(DISTINCT p.id)::BIGINT AS n
     FROM packs p
     JOIN pack_commitments pc ON pc.pack_id = p.id
     WHERE p.purchased_at >= $1
       AND p.purchased_at < $2`,
    [windowStart, windowEnd]
  );
  return Number(sampleResult.rows[0]?.n ?? 0);
}

export async function computeFairnessAudit(input: {
  windowStart: Date;
  windowEnd: Date;
  monteCarloSamples: number;
}): Promise<FairnessAuditComputation> {
  return withTransaction(async (client) => {
    const observed = await fetchObservedCounts(client, input.windowStart, input.windowEnd);
    const expectedCounts = await buildExpectedCounts(client, input.windowStart, input.windowEnd);
    const { statistic, degreesOfFreedom } = buildChiSquared(observed.counts, expectedCounts);
    const pValue = chiSquaredSurvivalPValue(statistic, degreesOfFreedom);

    const sparseBuckets = isSparseExpectedBucket(expectedCounts);
    let monteCarloSamples: number | null = null;
    let monteCarloExtremeCount: number | null = null;

    if (sparseBuckets && input.monteCarloSamples > 0) {
      const monteCarlo = runMonteCarloCalibration({
        observedStatistic: statistic,
        observedTotalCards: observed.totalCards,
        expectedCounts,
        samples: input.monteCarloSamples
      });
      monteCarloSamples = monteCarlo.samples;
      monteCarloExtremeCount = monteCarlo.extremeCount;
    }

    return {
      observedCounts: observed.counts,
      expectedCounts,
      testStatistic: Number(statistic.toFixed(10)),
      degreesOfFreedom,
      pValue: Number(pValue.toFixed(8)),
      sampleSize: observed.sampleSize,
      monteCarloApplied: monteCarloSamples !== null && monteCarloExtremeCount !== null,
      monteCarloSamples,
      monteCarloExtremeCount
    };
  });
}

export async function runFairnessAudit(input?: {
  runSource?: FairnessAuditRunSource;
  windowDays?: number;
  monteCarloSamples?: number;
  now?: Date;
}): Promise<FairnessAuditResult> {
  const runSource = input?.runSource ?? "on_demand";
  const windowDays = input?.windowDays ?? DEFAULT_WINDOW_DAYS;
  const now = input?.now ?? new Date();
  const monteCarloSamples =
    input?.monteCarloSamples ??
    (runSource === "nightly" ? NIGHTLY_MONTE_CARLO_SAMPLES : ON_DEMAND_MONTE_CARLO_SAMPLES);

  if (!Number.isInteger(windowDays) || windowDays <= 0 || windowDays > MAX_WINDOW_DAYS) {
    throw new ApiRouteError(
      `window must be between 1 and ${MAX_WINDOW_DAYS} days.`,
      400,
      "INVALID_WINDOW"
    );
  }

  const { windowStart, windowEnd } = getWindowBounds(windowDays, now);
  const computed = await computeFairnessAudit({
    windowStart,
    windowEnd,
    monteCarloSamples
  });

  return withTransaction(async (client) => {
    const inserted = await persistAuditResult(client, {
      windowStart,
      windowEnd,
      runSource,
      computed
    });
    return mapAuditRow(inserted, computed.sampleSize);
  });
}

export async function runNightlyFairnessAuditIfDue(now: Date = new Date()): Promise<FairnessAuditResult | null> {
  const dueResult = await query<{ is_due: boolean }>(
    `SELECT NOT EXISTS (
       SELECT 1
       FROM fairness_audit_results
       WHERE run_source = 'nightly'
         AND ran_at >= now() - interval '23 hours'
     ) AS is_due`
  );

  const isDue = dueResult.rows[0]?.is_due === true;
  if (!isDue) {
    return null;
  }

  return runFairnessAudit({
    runSource: "nightly",
    windowDays: DEFAULT_WINDOW_DAYS,
    monteCarloSamples: NIGHTLY_MONTE_CARLO_SAMPLES,
    now
  });
}

export async function getLatestFairnessAuditResult(windowDays = DEFAULT_WINDOW_DAYS): Promise<FairnessAuditResult | null> {
  if (!Number.isInteger(windowDays) || windowDays <= 0 || windowDays > MAX_WINDOW_DAYS) {
    throw new ApiRouteError(
      `window must be between 1 and ${MAX_WINDOW_DAYS} days.`,
      400,
      "INVALID_WINDOW"
    );
  }

  return withTransaction(async (client) => {
    const result = await client.query<FairnessAuditRow>(
      `SELECT
         id,
         window_start,
         window_end,
         observed_counts_json,
         expected_counts_json,
         test_statistic::text,
         degrees_of_freedom,
         p_value::text,
         monte_carlo_n_samples,
         monte_carlo_extreme_count,
         run_source,
         ran_at
       FROM fairness_audit_results
       WHERE ABS(
         EXTRACT(EPOCH FROM ((window_end - window_start) - make_interval(days => $1)))
       ) < 1
       ORDER BY ran_at DESC
       LIMIT 1`,
      [windowDays]
    );

    if (result.rowCount !== 1) {
      return null;
    }

    const row = result.rows[0];
    const sampleSize = await countSampleSizeForWindow(client, row.window_start, row.window_end);
    return mapAuditRow(row, sampleSize);
  });
}

export async function getLatestNightlyFairnessAuditResult(
  windowDays = DEFAULT_WINDOW_DAYS
): Promise<FairnessAuditResult | null> {
  if (!Number.isInteger(windowDays) || windowDays <= 0 || windowDays > MAX_WINDOW_DAYS) {
    throw new ApiRouteError(
      `window must be between 1 and ${MAX_WINDOW_DAYS} days.`,
      400,
      "INVALID_WINDOW"
    );
  }

  return withTransaction(async (client) => {
    const result = await client.query<FairnessAuditRow>(
      `SELECT
         id,
         window_start,
         window_end,
         observed_counts_json,
         expected_counts_json,
         test_statistic::text,
         degrees_of_freedom,
         p_value::text,
         monte_carlo_n_samples,
         monte_carlo_extreme_count,
         run_source,
         ran_at
       FROM fairness_audit_results
       WHERE run_source = 'nightly'
         AND ABS(
           EXTRACT(EPOCH FROM ((window_end - window_start) - make_interval(days => $1)))
         ) < 1
       ORDER BY ran_at DESC
       LIMIT 1`,
      [windowDays]
    );

    if (result.rowCount !== 1) {
      return null;
    }

    const row = result.rows[0];
    const sampleSize = await countSampleSizeForWindow(client, row.window_start, row.window_end);
    return mapAuditRow(row, sampleSize);
  });
}

export type PublicFairnessAuditResult = {
  windowStart: string;
  windowEnd: string;
  sampleSize: number;
  observedCounts: Record<RarityTier, number>;
  expectedCounts: Record<RarityTier, number>;
  pValue: number;
  chiSquared: number;
  degreesOfFreedom: number;
  monteCarloApplied: boolean;
  monteCarloSampleCount: number | null;
  runSource: "nightly";
  ranAt: string;
};

function mapPublicNightlyAuditResult(audit: FairnessAuditResult): PublicFairnessAuditResult {
  return {
    windowStart: audit.windowStartIso,
    windowEnd: audit.windowEndIso,
    sampleSize: audit.sampleSize,
    observedCounts: audit.observedCounts,
    expectedCounts: audit.expectedCounts,
    pValue: audit.pValue,
    chiSquared: audit.testStatistic,
    degreesOfFreedom: audit.degreesOfFreedom,
    monteCarloApplied: audit.monteCarloApplied,
    monteCarloSampleCount: audit.monteCarloSamples,
    runSource: "nightly",
    ranAt: audit.ranAtIso
  };
}

export async function getLatestPublicFairnessAuditResult(
  windowDays = DEFAULT_WINDOW_DAYS
): Promise<PublicFairnessAuditResult | null> {
  const audit = await getLatestNightlyFairnessAuditResult(windowDays);
  if (!audit) {
    return null;
  }

  return mapPublicNightlyAuditResult(audit);
}
