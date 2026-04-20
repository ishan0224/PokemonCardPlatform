import type { PoolClient } from "pg";
import { dollarsToCents } from "../src/lib/decimal";
import { PRICE_CACHE_TTL_SECONDS } from "../src/server/config/constants";
import { closeDatabasePool, query, withTransaction } from "../src/server/db/pool";
import { closeRedisClients, setPokemonCardPriceCache } from "../src/server/redis/client";

const POKEMON_TCG_API_URL = process.env.POKEMON_TCG_API_URL ?? "https://api.pokemontcg.io/v2/cards";
const POKEMON_TCG_API_KEY = process.env.POKEMON_TCG_API_KEY;

const DEFAULT_PAGE_SIZE = 250;
const DEFAULT_MAX_PAGES = 500;
const DEFAULT_ONLY_SIMULATED = true;
const DEFAULT_INSERT_BATCH_SIZE = 1_000;

const FETCH_TIMEOUT_MS = Number(process.env.POKEMON_TCG_FETCH_TIMEOUT_MS ?? 20_000);
const FETCH_RETRY_ATTEMPTS = Number(process.env.POKEMON_TCG_FETCH_RETRY_ATTEMPTS ?? 4);
const FETCH_RETRY_BASE_DELAY_MS = Number(process.env.POKEMON_TCG_FETCH_RETRY_BASE_DELAY_MS ?? 1_500);

type CliOptions = {
  dryRun: boolean;
  pageSize: number;
  maxPages: number;
  onlySimulated: boolean;
  updatedSinceHours: number | null;
};

type TcgApiCardPriceVariant = {
  market?: number | null;
  mid?: number | null;
  low?: number | null;
  directLow?: number | null;
};

type TcgApiCard = {
  id?: string;
  updatedAt?: string;
  tcgplayer?: {
    prices?: Record<string, TcgApiCardPriceVariant | null>;
  };
};

type TcgApiResponse = {
  data?: TcgApiCard[];
  page?: number;
  pageSize?: number;
  totalCount?: number;
};

type QuoteCandidate = {
  tcgId: string;
  externalPriceCents: number;
  fetchedAtIso: string;
};

type ScannedCandidate = {
  tcgId: string;
  hasQuote: boolean;
  fetchedAtIso: string;
};

type CrawlResult = {
  apiCardsScanned: number;
  pagesFetched: number;
  maxPagesHit: boolean;
  filteredByUpdatedSince: number;
  quoteCandidates: QuoteCandidate[];
  scannedCandidates: ScannedCandidate[];
};

type RefreshRow = {
  id: string;
  current_price: string;
  previous_price: string;
  last_price_update: string | null;
};

type SourceMixRow = {
  src: string;
  count: string;
};

class PriceRefreshHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk<T>(items: T[], size: number): T[][] {
  const safeSize = Math.max(Math.trunc(size), 1);
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += safeSize) {
    chunks.push(items.slice(index, index + safeSize));
  }

  return chunks;
}

function parseIntegerFlag(raw: string, flagName: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${flagName}: expected a number, received "${raw}".`);
  }

  const normalized = Math.trunc(parsed);
  if (normalized <= 0) {
    throw new Error(`Invalid ${flagName}: expected a positive integer, received "${raw}".`);
  }

  return normalized;
}

function parseBooleanFlag(raw: string, flagName: string): boolean {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  throw new Error(`Invalid ${flagName}: expected true/false, received "${raw}".`);
}

function parseCliOptions(args: string[]): CliOptions {
  let commit = false;
  let explicitDryRun = false;
  let pageSize = DEFAULT_PAGE_SIZE;
  let maxPages = DEFAULT_MAX_PAGES;
  let onlySimulated = DEFAULT_ONLY_SIMULATED;
  let updatedSinceHours: number | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--commit") {
      commit = true;
      continue;
    }

    if (arg === "--dry-run") {
      explicitDryRun = true;
      continue;
    }

    if (arg === "--page-size") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--page-size requires a value.");
      }
      pageSize = parseIntegerFlag(value, "--page-size");
      index += 1;
      continue;
    }

    if (arg.startsWith("--page-size=")) {
      pageSize = parseIntegerFlag(arg.slice("--page-size=".length), "--page-size");
      continue;
    }

    if (arg === "--max-pages") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--max-pages requires a value.");
      }
      maxPages = parseIntegerFlag(value, "--max-pages");
      index += 1;
      continue;
    }

    if (arg.startsWith("--max-pages=")) {
      maxPages = parseIntegerFlag(arg.slice("--max-pages=".length), "--max-pages");
      continue;
    }

    if (arg === "--only-simulated") {
      onlySimulated = true;
      continue;
    }

    if (arg.startsWith("--only-simulated=")) {
      onlySimulated = parseBooleanFlag(arg.slice("--only-simulated=".length), "--only-simulated");
      continue;
    }

    if (arg === "--updated-since-hours") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--updated-since-hours requires a value.");
      }
      updatedSinceHours = parseIntegerFlag(value, "--updated-since-hours");
      index += 1;
      continue;
    }

    if (arg.startsWith("--updated-since-hours=")) {
      updatedSinceHours = parseIntegerFlag(arg.slice("--updated-since-hours=".length), "--updated-since-hours");
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (commit && explicitDryRun) {
    throw new Error("Use either --commit or --dry-run, not both.");
  }

  return {
    dryRun: explicitDryRun || !commit,
    pageSize,
    maxPages,
    onlySimulated,
    updatedSinceHours
  };
}

function extractExternalPriceCents(card: TcgApiCard): number | null {
  const variants = card.tcgplayer?.prices;
  if (!variants) {
    return null;
  }

  for (const variant of Object.values(variants)) {
    if (!variant) {
      continue;
    }

    const candidates = [variant.market, variant.mid, variant.low, variant.directLow];
    for (const amount of candidates) {
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
        continue;
      }

      const cents = dollarsToCents(amount);
      if (Number.isFinite(cents) && cents > 0) {
        return Math.trunc(cents);
      }
    }
  }

  return null;
}

async function fetchCardsPage(page: number, pageSize: number): Promise<TcgApiResponse> {
  const url = new URL(POKEMON_TCG_API_URL);
  url.searchParams.set("page", String(page));
  url.searchParams.set("pageSize", String(pageSize));
  url.searchParams.set("orderBy", "set.releaseDate,name");

  const headers: Record<string, string> = {
    Accept: "application/json"
  };
  if (POKEMON_TCG_API_KEY) {
    headers["X-Api-Key"] = POKEMON_TCG_API_KEY;
  }

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= FETCH_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });

      if (response.ok) {
        return (await response.json()) as TcgApiResponse;
      }

      if (response.status === 429 || response.status >= 500) {
        const retryAfterSeconds = Number(response.headers.get("retry-after") ?? "0");
        const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1_000 : 0;
        const backoffMs = Math.max(retryAfterMs, FETCH_RETRY_BASE_DELAY_MS * attempt);
        console.warn(
          `[price-full-refresh] page=${page} attempt=${attempt}/${FETCH_RETRY_ATTEMPTS} status=${response.status} retryInMs=${backoffMs}`
        );
        await sleep(backoffMs);
        continue;
      }

      throw new PriceRefreshHttpError(
        response.status,
        `Pokemon TCG API request failed (${response.status} ${response.statusText}).`
      );
    } catch (error) {
      if (error instanceof PriceRefreshHttpError && error.status !== 429 && error.status < 500) {
        throw error;
      }

      lastError = error;
      if (attempt >= FETCH_RETRY_ATTEMPTS) {
        break;
      }

      const backoffMs = FETCH_RETRY_BASE_DELAY_MS * attempt;
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `[price-full-refresh] page=${page} attempt=${attempt}/${FETCH_RETRY_ATTEMPTS} error="${reason}" retryInMs=${backoffMs}`
      );
      await sleep(backoffMs);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Pokemon TCG API request failed after ${FETCH_RETRY_ATTEMPTS} attempts.`);
}

function isCardFreshEnough(card: TcgApiCard, updatedSinceHours: number | null): boolean {
  if (!updatedSinceHours) {
    return true;
  }

  const updatedAt = card.updatedAt;
  if (typeof updatedAt !== "string") {
    return false;
  }

  const updatedAtMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }

  const cutoffMs = Date.now() - updatedSinceHours * 60 * 60 * 1_000;
  return updatedAtMs >= cutoffMs;
}

async function crawlCards(options: CliOptions): Promise<CrawlResult> {
  const quoteByTcgId = new Map<string, QuoteCandidate>();
  const scannedByTcgId = new Map<string, ScannedCandidate>();

  let apiCardsScanned = 0;
  let pagesFetched = 0;
  let filteredByUpdatedSince = 0;
  let maxPagesHit = false;

  for (let page = 1; page <= options.maxPages; page += 1) {
    let response: TcgApiResponse;
    try {
      response = await fetchCardsPage(page, options.pageSize);
    } catch (error) {
      if (error instanceof PriceRefreshHttpError && error.status === 400 && page > 1) {
        console.warn(`[price-full-refresh] page=${page} returned 400; treating as end-of-catalog.`);
        break;
      }
      throw error;
    }

    pagesFetched = page;

    const pageCards = Array.isArray(response.data) ? response.data : [];
    apiCardsScanned += pageCards.length;

    if (pageCards.length === 0) {
      break;
    }

    for (const card of pageCards) {
      const tcgId = typeof card.id === "string" ? card.id.trim() : "";
      if (!tcgId) {
        continue;
      }

      if (!isCardFreshEnough(card, options.updatedSinceHours)) {
        filteredByUpdatedSince += 1;
        continue;
      }

      const fetchedAtIso = new Date().toISOString();
      const extractedPrice = extractExternalPriceCents(card);

      if (extractedPrice && extractedPrice > 0) {
        quoteByTcgId.set(tcgId, {
          tcgId,
          externalPriceCents: extractedPrice,
          fetchedAtIso
        });

        scannedByTcgId.set(tcgId, {
          tcgId,
          hasQuote: true,
          fetchedAtIso
        });
        continue;
      }

      const existing = scannedByTcgId.get(tcgId);
      if (!existing || !existing.hasQuote) {
        scannedByTcgId.set(tcgId, {
          tcgId,
          hasQuote: false,
          fetchedAtIso
        });
      }
    }

    const totalCount = Number(response.totalCount ?? 0);
    const reachedTotalCount = Number.isFinite(totalCount) && totalCount > 0 && page * options.pageSize >= totalCount;
    const reachedLastPageBySize = pageCards.length < options.pageSize;

    console.log(
      `[price-full-refresh] page=${page} scanned=${apiCardsScanned} quotes=${quoteByTcgId.size} considered=${scannedByTcgId.size}`
    );

    if (reachedTotalCount || reachedLastPageBySize) {
      break;
    }
  }

  if (pagesFetched >= options.maxPages) {
    maxPagesHit = true;
  }

  return {
    apiCardsScanned,
    pagesFetched,
    maxPagesHit,
    filteredByUpdatedSince,
    quoteCandidates: Array.from(quoteByTcgId.values()),
    scannedCandidates: Array.from(scannedByTcgId.values())
  };
}

async function insertQuoteBatch(client: PoolClient, rows: QuoteCandidate[]): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const tcgIds = rows.map((row) => row.tcgId);
  const prices = rows.map((row) => row.externalPriceCents);
  const fetchedAts = rows.map((row) => row.fetchedAtIso);

  await client.query(
    `INSERT INTO temp_price_refresh_quotes (tcg_id, external_price_cents, fetched_at)
     SELECT * FROM unnest($1::text[], $2::bigint[], $3::timestamptz[])
     ON CONFLICT (tcg_id)
     DO UPDATE SET
       external_price_cents = EXCLUDED.external_price_cents,
       fetched_at = EXCLUDED.fetched_at`,
    [tcgIds, prices, fetchedAts]
  );
}

async function insertScannedBatch(client: PoolClient, rows: ScannedCandidate[]): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const tcgIds = rows.map((row) => row.tcgId);
  const hasQuotes = rows.map((row) => row.hasQuote);
  const fetchedAts = rows.map((row) => row.fetchedAtIso);

  await client.query(
    `INSERT INTO temp_price_refresh_scanned (tcg_id, has_quote, fetched_at)
     SELECT * FROM unnest($1::text[], $2::boolean[], $3::timestamptz[])
     ON CONFLICT (tcg_id)
     DO UPDATE SET
       has_quote = EXCLUDED.has_quote,
       fetched_at = EXCLUDED.fetched_at`,
    [tcgIds, hasQuotes, fetchedAts]
  );
}

async function bulkStageCandidates(
  client: PoolClient,
  quoteCandidates: QuoteCandidate[],
  scannedCandidates: ScannedCandidate[]
): Promise<void> {
  await client.query(
    `CREATE TEMP TABLE temp_price_refresh_quotes (
       tcg_id text PRIMARY KEY,
       external_price_cents bigint NOT NULL CHECK (external_price_cents > 0),
       fetched_at timestamptz NOT NULL
     ) ON COMMIT DROP`
  );

  await client.query(
    `CREATE TEMP TABLE temp_price_refresh_scanned (
       tcg_id text PRIMARY KEY,
       has_quote boolean NOT NULL,
       fetched_at timestamptz NOT NULL
     ) ON COMMIT DROP`
  );

  const quoteBatches = chunk(quoteCandidates, DEFAULT_INSERT_BATCH_SIZE);
  for (const batch of quoteBatches) {
    await insertQuoteBatch(client, batch);
  }

  const scannedBatches = chunk(scannedCandidates, DEFAULT_INSERT_BATCH_SIZE);
  for (const batch of scannedBatches) {
    await insertScannedBatch(client, batch);
  }
}

async function readCount(client: PoolClient, sql: string, params: unknown[] = []): Promise<number> {
  const result = await client.query<{ count: string }>(sql, params);
  const parsed = Number(result.rows[0]?.count ?? "0");
  return Number.isFinite(parsed) ? Math.max(Math.trunc(parsed), 0) : 0;
}

async function executeRefresh(
  options: CliOptions,
  quoteCandidates: QuoteCandidate[],
  scannedCandidates: ScannedCandidate[]
): Promise<{
  matchedCatalogRows: number;
  matchedQuotedRows: number;
  missingQuoteRows: number;
  externalUpdatedRows: number;
  unchangedRows: number;
  cacheSyncAttempts: number;
}> {
  const refreshResult = await withTransaction(async (client) => {
    await bulkStageCandidates(client, quoteCandidates, scannedCandidates);

    const matchedCatalogRows = await readCount(
      client,
      `SELECT COUNT(*)::text AS count
       FROM pokemon_cards pc
       JOIN temp_price_refresh_scanned scanned ON scanned.tcg_id = pc.tcg_id`
    );

    const matchedQuotedRows = await readCount(
      client,
      `SELECT COUNT(*)::text AS count
       FROM pokemon_cards pc
       JOIN temp_price_refresh_quotes stage ON stage.tcg_id = pc.tcg_id`
    );

    const missingQuoteRows = await readCount(
      client,
      `SELECT COUNT(*)::text AS count
       FROM pokemon_cards pc
       JOIN temp_price_refresh_scanned scanned ON scanned.tcg_id = pc.tcg_id
       WHERE scanned.has_quote = false`
    );

    const updateFilterSql = `
      pc.current_price <> stage.external_price_cents
      AND ($1::boolean = false OR COALESCE(pc.last_price_source, 'simulated') <> 'external')
    `;

    const candidateUpdateRows = await readCount(
      client,
      `SELECT COUNT(*)::text AS count
       FROM pokemon_cards pc
       JOIN temp_price_refresh_quotes stage ON stage.tcg_id = pc.tcg_id
       WHERE ${updateFilterSql}`,
      [options.onlySimulated]
    );

    let updatedRows: RefreshRow[] = [];
    if (!options.dryRun) {
      const result = await client.query<RefreshRow>(
        `UPDATE pokemon_cards pc
         SET previous_price = pc.current_price,
             current_price = stage.external_price_cents,
             last_price_source = 'external',
             last_external_price_at = stage.fetched_at,
             last_price_update = now()
         FROM temp_price_refresh_quotes stage
         WHERE pc.tcg_id = stage.tcg_id
           AND ${updateFilterSql}
         RETURNING
           pc.id,
           pc.current_price::text,
           pc.previous_price::text,
           pc.last_price_update::text`,
        [options.onlySimulated]
      );
      updatedRows = result.rows;
    }

    const externalUpdatedRows = options.dryRun ? candidateUpdateRows : updatedRows.length;
    const unchangedRows = Math.max(matchedCatalogRows - externalUpdatedRows, 0);

    return {
      matchedCatalogRows,
      matchedQuotedRows,
      missingQuoteRows,
      externalUpdatedRows,
      unchangedRows,
      updatedRows
    };
  });

  let cacheSyncAttempts = 0;
  if (!options.dryRun && refreshResult.externalUpdatedRows > 0) {
    const cacheOps = refreshResult.updatedRows.map((row) =>
      setPokemonCardPriceCache(
        row.id,
        {
          currentPrice: Number(row.current_price),
          previousPrice: Number(row.previous_price),
          updatedAt: row.last_price_update ?? new Date().toISOString()
        },
        PRICE_CACHE_TTL_SECONDS
      )
    );
    cacheSyncAttempts = cacheOps.length;
    await Promise.allSettled(cacheOps);
  }

  return {
    matchedCatalogRows: refreshResult.matchedCatalogRows,
    matchedQuotedRows: refreshResult.matchedQuotedRows,
    missingQuoteRows: refreshResult.missingQuoteRows,
    externalUpdatedRows: refreshResult.externalUpdatedRows,
    unchangedRows: refreshResult.unchangedRows,
    cacheSyncAttempts
  };
}

async function readSourceMix(): Promise<Array<{ src: string; count: number }>> {
  const result = await query<SourceMixRow>(
    `SELECT COALESCE(last_price_source, '(null)') AS src,
            COUNT(*)::text AS count
     FROM pokemon_cards
     GROUP BY 1
     ORDER BY COUNT(*) DESC`
  );

  return result.rows.map((row) => ({
    src: row.src,
    count: Number(row.count)
  }));
}

async function readInvalidPriceCount(): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM pokemon_cards
     WHERE current_price < 0`
  );

  return Number(result.rows[0]?.count ?? "0");
}

async function main(): Promise<void> {
  const startedAtMs = Date.now();
  const options = parseCliOptions(process.argv.slice(2));

  console.log(
    `[price-full-refresh] mode=${options.dryRun ? "dry-run" : "commit"} pageSize=${options.pageSize} maxPages=${options.maxPages} onlySimulated=${options.onlySimulated} updatedSinceHours=${options.updatedSinceHours ?? "none"}`
  );

  const crawl = await crawlCards(options);
  const refresh = await executeRefresh(options, crawl.quoteCandidates, crawl.scannedCandidates);
  const sourceMix = await readSourceMix();
  const invalidPriceRows = await readInvalidPriceCount();

  const elapsedMs = Date.now() - startedAtMs;
  const summary = {
    mode: options.dryRun ? "dry-run" : "commit",
    totalApiCardsScanned: crawl.apiCardsScanned,
    pagesFetched: crawl.pagesFetched,
    maxPagesHit: crawl.maxPagesHit,
    filteredByUpdatedSince: crawl.filteredByUpdatedSince,
    quoteCandidates: crawl.quoteCandidates.length,
    scannedCandidates: crawl.scannedCandidates.length,
    matchedCatalogRows: refresh.matchedCatalogRows,
    matchedQuotedRows: refresh.matchedQuotedRows,
    externalUpdatedRows: refresh.externalUpdatedRows,
    unchangedRows: refresh.unchangedRows,
    missingQuoteRows: refresh.missingQuoteRows,
    cacheSyncAttempts: refresh.cacheSyncAttempts,
    invalidPriceRows,
    elapsedMs
  };

  console.log(`[price-full-refresh] summary=${JSON.stringify(summary)}`);
  console.log(`[price-full-refresh] sourceMix=${JSON.stringify(sourceMix)}`);
}

main()
  .catch((error) => {
    console.error("[price-full-refresh] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRedisClients();
    await closeDatabasePool();
  });
