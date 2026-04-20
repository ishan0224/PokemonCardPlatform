import {
  PRICE_UPDATE_EVENT,
  type PriceUpdateEntry,
  type PriceUpdateEvent
} from "../../lib/realtime/price-update";
import type { RarityTier } from "../../lib/types";
import {
  PRICE_CACHE_TTL_SECONDS,
  PRICE_COALESCING_ENABLED,
  PRICE_SELECTION_MODE,
  PRICE_REFRESH_HIGH_MAX_SECONDS,
  PRICE_REFRESH_HIGH_MIN_SECONDS,
  PRICE_REFRESH_ILLIQUID_MAX_SECONDS,
  PRICE_REFRESH_ILLIQUID_MIN_SECONDS,
  PRICE_REFRESH_LOW_MAX_SECONDS,
  PRICE_REFRESH_LOW_MIN_SECONDS,
  PRICE_REFRESH_MEDIUM_MAX_SECONDS,
  PRICE_REFRESH_MEDIUM_MIN_SECONDS,
  PRICE_POLLER_BATCH_SIZE,
  PRICE_POLLER_OWNED_PRIORITY_QUOTA,
  PRICE_SIMULATION_CAP_BPS,
  PRICE_SIMULATION_MAX_DRIFT_BPS,
  PRICE_SIMULATION_SET_DRIFT_BPS,
  PRICE_SOURCE_BATCH_SIZE,
  PRICE_SOURCE_TIMEOUT_MS,
  PRICE_TRIAL_OWNED_NEAR_DUE_CAP,
  PRICE_TRIAL_OWNED_TARGET_PER_TICK,
  PRICE_UPDATE_COALESCE_WINDOW_MS,
  PRICE_UPDATES_CHANNEL,
  type PriceSelectionMode
} from "../config/constants";
import { query, withTransaction } from "../db/pool";
import { canUseRedisPubSub, publish, setPokemonCardPriceCache } from "../redis/client";
import { getIO } from "../websocket/io";
import { roomNames } from "../websocket/rooms";

type PokemonCardCatalogRow = {
  id: string;
  tcg_id: string;
  set_id: string | null;
  rarity_tier: RarityTier;
  liquidity_tier: "high" | "medium" | "low" | "illiquid" | null;
  current_price: string;
  last_price_source: PriceSourceType | null;
  last_external_price_at: string | null;
};

type UpdatedPokemonCardRow = {
  id: string;
  current_price: string;
  previous_price: string;
  last_price_update: string | null;
};

type OwnedCardPriceRow = {
  card_id: string;
  owner_id: string;
  pokemon_card_id: string;
  rarity_tier: RarityTier;
  current_price: string;
  previous_price: string;
  last_price_update: string | null;
};

type PriceUpdateCandidate = {
  id: string;
  nextPrice: number;
  source: PriceSourceType;
};

type FetchCatalogBatchResult = {
  rows: PokemonCardCatalogRow[];
  nextCursor: string | null;
  wrapped: boolean;
};

type FetchOwnedPokemonCardIdBatchResult = {
  pokemonCardIds: string[];
  nextCursor: string | null;
  wrapped: boolean;
};

type OwnedPokemonCardIdRow = {
  pokemon_card_id: string;
};

type DuePokemonCardIdRow = {
  id: string;
};

type PriceSourceType = "external" | "simulated";

type ResolvedPrice = {
  nextPrice: number;
  source: PriceSourceType;
};

type ResolvedPriceMap = Map<string, ResolvedPrice>;

type TcgApiCardPriceVariant = {
  market?: number | null;
  mid?: number | null;
  low?: number | null;
  directLow?: number | null;
};

type TcgApiCard = {
  id?: string;
  tcgplayer?: {
    prices?: Record<string, TcgApiCardPriceVariant | null>;
  };
};

type TcgApiResponse = {
  data?: TcgApiCard[];
};

export type PollPriceBatchResult = {
  scannedCards: number;
  changedCards: number;
  emittedUsers: number;
  nextCursor: PollPriceCursor;
  wrapped: boolean;
};

export type ProcessPriceBatchResult = {
  scannedCards: number;
  changedCards: number;
  emittedUsers: number;
};

export type DueSelectionDiagnostics = {
  mode: PriceSelectionMode;
  limit: number;
  ownedQuota: number;
  trialOwnedTarget: number;
  trialOwnedNearDueCap: number;
  selectedOwnedDue: number;
  selectedOwnedNearDue: number;
  selectedCatalogDue: number;
  totalSelected: number;
};

export type DueSelectionResult = {
  pokemonCardIds: string[];
  diagnostics: DueSelectionDiagnostics;
};

export type PollPriceCursor = {
  catalogCursor: string | null;
  ownedCursor: string | null;
};

const FALLBACK_BASE_PRICE_CENTS_BY_RARITY: Record<RarityTier, number> = {
  common: 5,
  uncommon: 25,
  rare: 100,
  holo_rare: 300,
  ultra_rare: 1_200,
  chase: 5_000
};

const POKEMON_TCG_API_URL = process.env.POKEMON_TCG_API_URL ?? "https://api.pokemontcg.io/v2/cards";
const POKEMON_TCG_API_KEY = process.env.POKEMON_TCG_API_KEY;
const PRICE_SOURCE_ENABLED = (process.env.PRICE_SOURCE_ENABLED ?? "true").toLowerCase() !== "false";

function toMoneyCents(value: string | number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(Math.trunc(parsed), 0);
}

function dollarsToCents(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(Math.round(value * 100), 0);
}

function applyBps(value: number, bps: number): number {
  return Math.max(Math.round((value * (10_000 + bps)) / 10_000), 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function randomBps(maxAbsBps: number): number {
  const safeMax = Math.max(Math.trunc(maxAbsBps), 0);
  const span = safeMax * 2 + 1;
  return Math.trunc(Math.random() * span) - safeMax;
}

function chunk<T>(items: T[], size: number): T[][] {
  const safeSize = Math.max(Math.trunc(size), 1);
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += safeSize) {
    chunks.push(items.slice(index, index + safeSize));
  }

  return chunks;
}

function resolveSimulationBand(rarityTier: RarityTier): { min: number; max: number } {
  const rarityBase = Math.max(FALLBACK_BASE_PRICE_CENTS_BY_RARITY[rarityTier] ?? 1, 1);
  const minFromBase = Math.max(applyBps(rarityBase, -PRICE_SIMULATION_CAP_BPS), 1);
  const maxFromBase = Math.max(applyBps(rarityBase, PRICE_SIMULATION_CAP_BPS), minFromBase);

  return {
    min: minFromBase,
    max: maxFromBase
  };
}

function calculateNextSimulatedPrice(row: PokemonCardCatalogRow, setDriftBySetId: Map<string, number>): number {
  const currentPrice = Math.max(toMoneyCents(row.current_price), 1);
  const setKey = row.set_id ?? "__unknown_set";
  const setDrift = setDriftBySetId.get(setKey) ?? 0;
  const randomWalkDrift = randomBps(PRICE_SIMULATION_MAX_DRIFT_BPS);
  const totalDrift = randomWalkDrift + setDrift;
  const proposed = applyBps(currentPrice, totalDrift);
  const band = resolveSimulationBand(row.rarity_tier);

  return clamp(proposed, band.min, band.max);
}

function extractMarketPriceCentsFromApiCard(card: TcgApiCard): number | null {
  const priceVariants = card.tcgplayer?.prices;
  if (!priceVariants) {
    return null;
  }

  for (const variant of Object.values(priceVariants)) {
    if (!variant) {
      continue;
    }

    const candidates = [variant.market, variant.mid, variant.low, variant.directLow];
    for (const amount of candidates) {
      if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) {
        return dollarsToCents(amount);
      }
    }
  }

  return null;
}

async function fetchExternalPriceMapByTcgId(tcgIds: string[]): Promise<Map<string, number>> {
  const priceByTcgId = new Map<string, number>();
  if (tcgIds.length === 0 || !PRICE_SOURCE_ENABLED) {
    return priceByTcgId;
  }

  const uniqueTcgIds = Array.from(new Set(tcgIds));
  const chunksById = chunk(uniqueTcgIds, PRICE_SOURCE_BATCH_SIZE);

  for (const group of chunksById) {
    const url = new URL(POKEMON_TCG_API_URL);
    url.searchParams.set("q", group.map((tcgId) => `id:${tcgId}`).join(" OR "));
    url.searchParams.set("pageSize", String(group.length));

    const headers: Record<string, string> = {
      Accept: "application/json"
    };
    if (POKEMON_TCG_API_KEY) {
      headers["X-Api-Key"] = POKEMON_TCG_API_KEY;
    }

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(PRICE_SOURCE_TIMEOUT_MS)
      });

      if (!response.ok) {
        throw new Error(`status=${response.status}`);
      }

      const body = (await response.json()) as TcgApiResponse;
      const cards = Array.isArray(body.data) ? body.data : [];

      for (const card of cards) {
        const tcgId = typeof card.id === "string" ? card.id : null;
        if (!tcgId) {
          continue;
        }

        const extracted = extractMarketPriceCentsFromApiCard(card);
        if (typeof extracted === "number" && extracted > 0) {
          priceByTcgId.set(tcgId, extracted);
        }
      }
    } catch (error) {
      const typed = error as { message?: string };
      console.warn(`[price-source] External fetch failed for ${group.length} cards: ${typed.message ?? "unknown error"}`);
    }
  }

  return priceByTcgId;
}

async function readOwnedPokemonCardIdBatch(
  cursor: string | null,
  limit: number
): Promise<FetchOwnedPokemonCardIdBatchResult> {
  const safeLimit = Math.max(Math.trunc(limit), 0);

  if (safeLimit === 0) {
    return {
      pokemonCardIds: [],
      nextCursor: cursor,
      wrapped: false
    };
  }

  if (!cursor) {
    const fromStart = await query<OwnedPokemonCardIdRow>(
      `SELECT DISTINCT pokemon_card_id
       FROM cards
       WHERE state <> 'in_pack'
       ORDER BY pokemon_card_id ASC
       LIMIT $1`,
      [safeLimit]
    );

    const pokemonCardIds = fromStart.rows.map((row) => row.pokemon_card_id);

    return {
      pokemonCardIds,
      nextCursor: pokemonCardIds.at(-1) ?? null,
      wrapped: false
    };
  }

  const afterCursor = await query<OwnedPokemonCardIdRow>(
    `SELECT DISTINCT pokemon_card_id
     FROM cards
     WHERE state <> 'in_pack'
       AND pokemon_card_id > $1
     ORDER BY pokemon_card_id ASC
     LIMIT $2`,
    [cursor, safeLimit]
  );

  if (afterCursor.rows.length === safeLimit) {
    const pokemonCardIds = afterCursor.rows.map((row) => row.pokemon_card_id);

    return {
      pokemonCardIds,
      nextCursor: pokemonCardIds.at(-1) ?? cursor,
      wrapped: false
    };
  }

  const remaining = safeLimit - afterCursor.rows.length;
  const wrappedRows =
    remaining > 0
      ? await query<OwnedPokemonCardIdRow>(
          `SELECT DISTINCT pokemon_card_id
           FROM cards
           WHERE state <> 'in_pack'
             AND pokemon_card_id <= $1
           ORDER BY pokemon_card_id ASC
           LIMIT $2`,
          [cursor, remaining]
        )
      : { rows: [] as OwnedPokemonCardIdRow[] };

  const pokemonCardIds = [...afterCursor.rows, ...wrappedRows.rows].map((row) => row.pokemon_card_id);

  return {
    pokemonCardIds,
    nextCursor: pokemonCardIds.at(-1) ?? cursor,
    wrapped: true
  };
}

async function readCatalogRowsByIds(pokemonCardIds: string[]): Promise<PokemonCardCatalogRow[]> {
  if (pokemonCardIds.length === 0) {
    return [];
  }

  const result = await query<PokemonCardCatalogRow>(
    `SELECT pc.id,
            pc.tcg_id,
            pc.set_id,
            pc.rarity_tier,
            pc.liquidity_tier,
            pc.current_price,
            pc.last_price_source,
            pc.last_external_price_at
     FROM unnest($1::uuid[]) WITH ORDINALITY AS selected(pokemon_card_id, ord)
     JOIN pokemon_cards pc ON pc.id = selected.pokemon_card_id
     ORDER BY selected.ord ASC`,
    [pokemonCardIds]
  );

  return result.rows;
}

async function readCatalogBatch(
  cursor: string | null,
  limit: number,
  excludedPokemonCardIds: string[]
): Promise<FetchCatalogBatchResult> {
  const safeLimit = Math.max(Math.trunc(limit), 0);

  if (safeLimit === 0) {
    return {
      rows: [],
      nextCursor: cursor,
      wrapped: false
    };
  }

  if (!cursor) {
    const fromStart = await query<PokemonCardCatalogRow>(
      `SELECT id,
              tcg_id,
              set_id,
              rarity_tier,
              liquidity_tier,
              current_price,
              last_price_source,
              last_external_price_at
       FROM pokemon_cards
       WHERE NOT (id = ANY($2::uuid[]))
       ORDER BY id ASC
       LIMIT $1`,
      [safeLimit, excludedPokemonCardIds]
    );

    return {
      rows: fromStart.rows,
      nextCursor: fromStart.rows.at(-1)?.id ?? null,
      wrapped: false
    };
  }

  const afterCursor = await query<PokemonCardCatalogRow>(
    `SELECT id,
            tcg_id,
            set_id,
            rarity_tier,
            liquidity_tier,
            current_price,
            last_price_source,
            last_external_price_at
     FROM pokemon_cards
     WHERE id > $1
       AND NOT (id = ANY($3::uuid[]))
     ORDER BY id ASC
     LIMIT $2`,
    [cursor, safeLimit, excludedPokemonCardIds]
  );

  if (afterCursor.rows.length === safeLimit) {
    return {
      rows: afterCursor.rows,
      nextCursor: afterCursor.rows.at(-1)?.id ?? null,
      wrapped: false
    };
  }

  const remaining = safeLimit - afterCursor.rows.length;
  const fromStart =
    remaining > 0
      ? await query<PokemonCardCatalogRow>(
          `SELECT id,
                  tcg_id,
                  set_id,
                  rarity_tier,
                  liquidity_tier,
                  current_price,
                  last_price_source,
                  last_external_price_at
           FROM pokemon_cards
           WHERE id <= $1
             AND NOT (id = ANY($3::uuid[]))
           ORDER BY id ASC
           LIMIT $2`,
          [cursor, remaining, excludedPokemonCardIds]
        )
      : { rows: [] as PokemonCardCatalogRow[] };

  const rows = [...afterCursor.rows, ...fromStart.rows];

  return {
    rows,
    nextCursor: rows.at(-1)?.id ?? cursor,
    wrapped: true
  };
}

function normalizeSelectionLimit(limit: number): number {
  return Math.max(Math.trunc(limit), 0);
}

function normalizeOwnedQuota(ownedQuota: number, limit: number): number {
  return Math.min(Math.max(Math.trunc(ownedQuota), 0), limit);
}

function normalizeTrialOwnedTarget(limit: number): number {
  return Math.min(Math.max(Math.trunc(PRICE_TRIAL_OWNED_TARGET_PER_TICK), 0), limit);
}

function normalizeTrialOwnedNearDueCap(limit: number): number {
  return Math.min(Math.max(Math.trunc(PRICE_TRIAL_OWNED_NEAR_DUE_CAP), 0), limit);
}

function appendUniqueIds(target: string[], seen: Set<string>, candidateIds: string[]): number {
  let appended = 0;
  for (const id of candidateIds) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    target.push(id);
    appended += 1;
  }
  return appended;
}

async function readOwnedDuePokemonCardIds(limit: number): Promise<string[]> {
  const safeLimit = normalizeSelectionLimit(limit);
  if (safeLimit === 0) {
    return [];
  }

  const result = await query<DuePokemonCardIdRow>(
    `SELECT pc.id
     FROM pokemon_cards pc
     WHERE pc.next_price_refresh_at IS NOT NULL
       AND pc.next_price_refresh_at <= now()
       AND EXISTS (
         SELECT 1
         FROM cards c
         WHERE c.pokemon_card_id = pc.id
           AND c.state <> 'in_pack'
       )
     ORDER BY pc.next_price_refresh_at ASC, pc.id ASC
     LIMIT $1`,
    [safeLimit]
  );

  return result.rows.map((row) => row.id);
}

async function readOwnedNearDuePokemonCardIds(limit: number, excludedIds: string[]): Promise<string[]> {
  const safeLimit = normalizeSelectionLimit(limit);
  if (safeLimit === 0) {
    return [];
  }

  const result = await query<DuePokemonCardIdRow>(
    `SELECT pc.id
     FROM pokemon_cards pc
     WHERE pc.next_price_refresh_at IS NOT NULL
       AND pc.next_price_refresh_at > now()
       AND EXISTS (
         SELECT 1
         FROM cards c
         WHERE c.pokemon_card_id = pc.id
           AND c.state <> 'in_pack'
       )
       AND NOT (pc.id = ANY($2::uuid[]))
     ORDER BY pc.next_price_refresh_at ASC, pc.id ASC
     LIMIT $1`,
    [safeLimit, excludedIds]
  );

  return result.rows.map((row) => row.id);
}

async function readCatalogDuePokemonCardIds(limit: number, excludedIds: string[]): Promise<string[]> {
  const safeLimit = normalizeSelectionLimit(limit);
  if (safeLimit === 0) {
    return [];
  }

  const result = await query<DuePokemonCardIdRow>(
    `SELECT pc.id
     FROM pokemon_cards pc
     WHERE pc.next_price_refresh_at IS NOT NULL
       AND pc.next_price_refresh_at <= now()
       AND NOT (pc.id = ANY($2::uuid[]))
     ORDER BY CASE pc.liquidity_tier
                WHEN 'high' THEN 1
                WHEN 'medium' THEN 2
                WHEN 'low' THEN 3
                ELSE 4
              END ASC,
              pc.next_price_refresh_at ASC,
              pc.id ASC
     LIMIT $1`,
    [safeLimit, excludedIds]
  );

  return result.rows.map((row) => row.id);
}

function buildSelectionDiagnostics(input: {
  mode: PriceSelectionMode;
  limit: number;
  ownedQuota: number;
  trialOwnedTarget: number;
  trialOwnedNearDueCap: number;
  selectedOwnedDue: number;
  selectedOwnedNearDue: number;
  selectedCatalogDue: number;
}): DueSelectionDiagnostics {
  return {
    mode: input.mode,
    limit: input.limit,
    ownedQuota: input.ownedQuota,
    trialOwnedTarget: input.trialOwnedTarget,
    trialOwnedNearDueCap: input.trialOwnedNearDueCap,
    selectedOwnedDue: input.selectedOwnedDue,
    selectedOwnedNearDue: input.selectedOwnedNearDue,
    selectedCatalogDue: input.selectedCatalogDue,
    totalSelected: input.selectedOwnedDue + input.selectedOwnedNearDue + input.selectedCatalogDue
  };
}

export async function selectDuePokemonCardIdsWithDiagnostics(
  limit: number,
  ownedQuota: number
): Promise<DueSelectionResult> {
  const safeLimit = normalizeSelectionLimit(limit);
  const safeOwnedQuota = normalizeOwnedQuota(ownedQuota, safeLimit);
  const trialOwnedTarget = normalizeTrialOwnedTarget(safeLimit);
  const trialOwnedNearDueCap = normalizeTrialOwnedNearDueCap(safeLimit);

  if (safeLimit === 0) {
    return {
      pokemonCardIds: [],
      diagnostics: buildSelectionDiagnostics({
        mode: PRICE_SELECTION_MODE,
        limit: safeLimit,
        ownedQuota: safeOwnedQuota,
        trialOwnedTarget,
        trialOwnedNearDueCap,
        selectedOwnedDue: 0,
        selectedOwnedNearDue: 0,
        selectedCatalogDue: 0
      })
    };
  }

  const selectedIds: string[] = [];
  const selectedSet = new Set<string>();
  let selectedOwnedDue = 0;
  let selectedOwnedNearDue = 0;
  let selectedCatalogDue = 0;

  if (PRICE_SELECTION_MODE === "trial") {
    const ownedDueIds = await readOwnedDuePokemonCardIds(safeLimit);
    selectedOwnedDue += appendUniqueIds(selectedIds, selectedSet, ownedDueIds);

    let remainingLimit = safeLimit - selectedIds.length;
    const remainingToOwnedTarget = Math.max(trialOwnedTarget - selectedOwnedDue, 0);
    const nearDueLimit = Math.min(remainingLimit, remainingToOwnedTarget, trialOwnedNearDueCap);

    if (nearDueLimit > 0) {
      const ownedNearDueIds = await readOwnedNearDuePokemonCardIds(nearDueLimit, selectedIds);
      selectedOwnedNearDue += appendUniqueIds(selectedIds, selectedSet, ownedNearDueIds);
      remainingLimit = safeLimit - selectedIds.length;
    }

    if (remainingLimit > 0) {
      const catalogDueIds = await readCatalogDuePokemonCardIds(remainingLimit, selectedIds);
      selectedCatalogDue += appendUniqueIds(selectedIds, selectedSet, catalogDueIds);
    }
  } else {
    const ownedDueIds = await readOwnedDuePokemonCardIds(safeOwnedQuota);
    selectedOwnedDue += appendUniqueIds(selectedIds, selectedSet, ownedDueIds);

    const remainingLimit = safeLimit - selectedIds.length;
    if (remainingLimit > 0) {
      const catalogDueIds = await readCatalogDuePokemonCardIds(remainingLimit, selectedIds);
      selectedCatalogDue += appendUniqueIds(selectedIds, selectedSet, catalogDueIds);
    }
  }

  return {
    pokemonCardIds: selectedIds,
    diagnostics: buildSelectionDiagnostics({
      mode: PRICE_SELECTION_MODE,
      limit: safeLimit,
      ownedQuota: safeOwnedQuota,
      trialOwnedTarget,
      trialOwnedNearDueCap,
      selectedOwnedDue,
      selectedOwnedNearDue,
      selectedCatalogDue
    })
  };
}

export async function selectDuePokemonCardIds(limit: number, ownedQuota: number): Promise<string[]> {
  const result = await selectDuePokemonCardIdsWithDiagnostics(limit, ownedQuota);
  return result.pokemonCardIds;
}

function buildSetDriftMap(rows: PokemonCardCatalogRow[]): Map<string, number> {
  const setDriftBySetId = new Map<string, number>();

  for (const row of rows) {
    const setKey = row.set_id ?? "__unknown_set";
    if (!setDriftBySetId.has(setKey)) {
      setDriftBySetId.set(setKey, randomBps(PRICE_SIMULATION_SET_DRIFT_BPS));
    }
  }

  return setDriftBySetId;
}

async function resolvePriceSource(rows: PokemonCardCatalogRow[]): Promise<ResolvedPriceMap> {
  const priceByPokemonCardId = new Map<string, ResolvedPrice>();
  const externalByTcgId = await fetchExternalPriceMapByTcgId(rows.map((row) => row.tcg_id));
  const setDriftBySetId = buildSetDriftMap(rows);

  for (const row of rows) {
    const externalPrice = externalByTcgId.get(row.tcg_id);
    if (typeof externalPrice === "number" && externalPrice > 0) {
      priceByPokemonCardId.set(row.id, {
        nextPrice: externalPrice,
        source: "external"
      });
      continue;
    }

    // Never degrade previously external-priced cards to simulated when an external
    // quote is temporarily unavailable in this poll cycle.
    if (row.last_price_source === "external" || row.last_external_price_at !== null) {
      priceByPokemonCardId.set(row.id, {
        nextPrice: Math.max(toMoneyCents(row.current_price), 1),
        source: "external"
      });
      continue;
    }

    priceByPokemonCardId.set(row.id, {
      nextPrice: calculateNextSimulatedPrice(row, setDriftBySetId),
      source: "simulated"
    });
  }

  return priceByPokemonCardId;
}

async function updateCatalogPrices(candidates: PriceUpdateCandidate[]): Promise<UpdatedPokemonCardRow[]> {
  if (candidates.length === 0) {
    return [];
  }

  return withTransaction(async (client) => {
    const updatedRows: UpdatedPokemonCardRow[] = [];

    for (const candidate of candidates) {
      const result = await client.query<UpdatedPokemonCardRow>(
        `UPDATE pokemon_cards
         SET previous_price = current_price,
             current_price = $2,
             last_price_update = now(),
             last_price_source = $3::varchar,
             last_external_price_at = CASE
               WHEN $3::varchar = 'external' THEN now()
               ELSE last_external_price_at
             END
         WHERE id = $1
           AND current_price <> $2
         RETURNING id, current_price, previous_price, last_price_update`,
        [candidate.id, candidate.nextPrice, candidate.source]
      );

      if (result.rowCount === 1) {
        updatedRows.push(result.rows[0]);
      }
    }

    return updatedRows;
  });
}

async function syncPriceCache(rows: UpdatedPokemonCardRow[]): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const ops = rows.map((row) =>
    setPokemonCardPriceCache(
      row.id,
      {
        currentPrice: toMoneyCents(row.current_price),
        previousPrice: toMoneyCents(row.previous_price),
        updatedAt: row.last_price_update ?? new Date().toISOString()
      },
      PRICE_CACHE_TTL_SECONDS
    )
  );

  await Promise.allSettled(ops);
}

async function readOwnedCardsForPriceChanges(pokemonCardIds: string[]): Promise<OwnedCardPriceRow[]> {
  if (pokemonCardIds.length === 0) {
    return [];
  }

  const result = await query<OwnedCardPriceRow>(
    `SELECT c.id AS card_id,
            c.owner_id,
            c.pokemon_card_id,
            c.rarity_tier,
            pc.current_price,
            pc.previous_price,
            pc.last_price_update
     FROM cards c
     JOIN pokemon_cards pc ON pc.id = c.pokemon_card_id
     WHERE c.state <> 'in_pack'
       AND c.pokemon_card_id = ANY($1::uuid[])
     ORDER BY c.owner_id ASC, c.id ASC`,
    [pokemonCardIds]
  );

  return result.rows;
}

function randomIntegerInRange(min: number, max: number): number {
  const safeMin = Math.max(Math.trunc(min), 1);
  const safeMax = Math.max(Math.trunc(max), safeMin);
  const span = safeMax - safeMin + 1;
  return safeMin + Math.trunc(Math.random() * span);
}

function resolveRefreshWindowSeconds(liquidityTier: PokemonCardCatalogRow["liquidity_tier"]): { min: number; max: number } {
  switch (liquidityTier) {
    case "high":
      return {
        min: PRICE_REFRESH_HIGH_MIN_SECONDS,
        max: PRICE_REFRESH_HIGH_MAX_SECONDS
      };
    case "medium":
      return {
        min: PRICE_REFRESH_MEDIUM_MIN_SECONDS,
        max: PRICE_REFRESH_MEDIUM_MAX_SECONDS
      };
    case "low":
      return {
        min: PRICE_REFRESH_LOW_MIN_SECONDS,
        max: PRICE_REFRESH_LOW_MAX_SECONDS
      };
    case "illiquid":
    default:
      return {
        min: PRICE_REFRESH_ILLIQUID_MIN_SECONDS,
        max: PRICE_REFRESH_ILLIQUID_MAX_SECONDS
      };
  }
}

async function scheduleNextPriceRefresh(rows: PokemonCardCatalogRow[]): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  await withTransaction(async (client) => {
    for (const row of rows) {
      const window = resolveRefreshWindowSeconds(row.liquidity_tier);
      const offsetSeconds = randomIntegerInRange(window.min, window.max);
      const nextRefreshAt = new Date(Date.now() + offsetSeconds * 1_000).toISOString();

      await client.query(
        `UPDATE pokemon_cards
         SET next_price_refresh_at = $2
         WHERE id = $1`,
        [row.id, nextRefreshAt]
      );
    }
  });
}

function calculateChangePercent(previousPrice: number, currentPrice: number): number {
  if (previousPrice <= 0) {
    return 0;
  }

  const raw = ((currentPrice - previousPrice) / previousPrice) * 100;
  return Number(raw.toFixed(2));
}

function buildPriceUpdatePayloads(rows: OwnedCardPriceRow[]): PriceUpdateEvent[] {
  const grouped = new Map<
    string,
    {
      updates: PriceUpdateEntry[];
      totalMarketValueDelta: number;
      byRarity: Map<RarityTier, number>;
      latestUpdatedAt: string;
    }
  >();

  for (const row of rows) {
    const currentPrice = toMoneyCents(row.current_price);
    const previousPrice = toMoneyCents(row.previous_price);
    const delta = currentPrice - previousPrice;
    const updatedAt = row.last_price_update ?? new Date().toISOString();

    const entry: PriceUpdateEntry = {
      cardId: row.card_id,
      pokemonCardId: row.pokemon_card_id,
      rarityTier: row.rarity_tier,
      newPrice: currentPrice,
      previousPrice,
      changePercent: calculateChangePercent(previousPrice, currentPrice),
      updatedAt
    };

    if (!grouped.has(row.owner_id)) {
      grouped.set(row.owner_id, {
        updates: [],
        totalMarketValueDelta: 0,
        byRarity: new Map<RarityTier, number>(),
        latestUpdatedAt: updatedAt
      });
    }

    const group = grouped.get(row.owner_id);
    if (!group) {
      continue;
    }

    group.updates.push(entry);
    group.totalMarketValueDelta += delta;
    group.latestUpdatedAt = group.latestUpdatedAt > updatedAt ? group.latestUpdatedAt : updatedAt;
    group.byRarity.set(row.rarity_tier, (group.byRarity.get(row.rarity_tier) ?? 0) + delta);
  }

  return Array.from(grouped.entries()).map(([userId, group]) => ({
    userId,
    updates: group.updates,
    portfolioDelta: {
      totalMarketValueDelta: group.totalMarketValueDelta,
      totalPnlDelta: group.totalMarketValueDelta,
      byRarity: Array.from(group.byRarity.entries()).map(([rarityTier, marketValueDelta]) => ({
        rarityTier,
        marketValueDelta
      }))
    },
    updatedAt: group.latestUpdatedAt
  }));
}

function buildPortfolioDeltaFromUpdates(updates: PriceUpdateEntry[]): PriceUpdateEvent["portfolioDelta"] {
  let totalMarketValueDelta = 0;
  const byRarity = new Map<RarityTier, number>();

  for (const update of updates) {
    const delta = update.newPrice - update.previousPrice;
    totalMarketValueDelta += delta;
    byRarity.set(update.rarityTier, (byRarity.get(update.rarityTier) ?? 0) + delta);
  }

  return {
    totalMarketValueDelta,
    totalPnlDelta: totalMarketValueDelta,
    byRarity: Array.from(byRarity.entries()).map(([rarityTier, marketValueDelta]) => ({
      rarityTier,
      marketValueDelta
    }))
  };
}

function buildCoalescedPayload(userId: string, updates: PriceUpdateEntry[], updatedAt: string): PriceUpdateEvent {
  return {
    userId,
    updates,
    portfolioDelta: buildPortfolioDeltaFromUpdates(updates),
    updatedAt
  };
}

async function emitPriceUpdateViaSocket(payload: PriceUpdateEvent): Promise<void> {
  try {
    const io = getIO();
    io.to(roomNames.portfolio(payload.userId)).emit(PRICE_UPDATE_EVENT, payload);
  } catch (_error) {
    // Socket server may be unavailable in script/test contexts.
  }
}

export async function emitPriceUpdateRealtime(payload: PriceUpdateEvent): Promise<void> {
  const message = JSON.stringify({ event: PRICE_UPDATE_EVENT, payload });

  if (canUseRedisPubSub()) {
    try {
      await publish(PRICE_UPDATES_CHANNEL, message);
      return;
    } catch (error) {
      const typed = error as { message?: string };
      console.warn(`[price-events] Redis publish failed: ${typed.message ?? "unknown error"}`);
      await emitPriceUpdateViaSocket(payload);
      return;
    }
  }

  await emitPriceUpdateViaSocket(payload);
}

type PendingCoalescedUserState = {
  updatesByCardId: Map<string, PriceUpdateEntry>;
  latestUpdatedAt: string;
};

const pendingCoalescedByUser = new Map<string, PendingCoalescedUserState>();
let coalescerTimer: NodeJS.Timeout | null = null;
let coalescerFlushing = false;

function mergeCoalescedPayload(payload: PriceUpdateEvent): void {
  const state = pendingCoalescedByUser.get(payload.userId) ?? {
    updatesByCardId: new Map<string, PriceUpdateEntry>(),
    latestUpdatedAt: payload.updatedAt
  };

  for (const update of payload.updates) {
    state.updatesByCardId.set(update.cardId, update);
    state.latestUpdatedAt = state.latestUpdatedAt > update.updatedAt ? state.latestUpdatedAt : update.updatedAt;
  }

  state.latestUpdatedAt = state.latestUpdatedAt > payload.updatedAt ? state.latestUpdatedAt : payload.updatedAt;
  pendingCoalescedByUser.set(payload.userId, state);
}

async function flushQueuedCoalescedPayloads(): Promise<void> {
  if (coalescerFlushing || pendingCoalescedByUser.size === 0) {
    return;
  }

  coalescerFlushing = true;
  const pendingEntries = Array.from(pendingCoalescedByUser.entries());
  pendingCoalescedByUser.clear();

  try {
    const payloads = pendingEntries
      .map(([userId, state]) => buildCoalescedPayload(userId, Array.from(state.updatesByCardId.values()), state.latestUpdatedAt))
      .filter((payload) => payload.updates.length > 0);

    const results = await Promise.allSettled(payloads.map((payload) => emitPriceUpdateRealtime(payload)));
    for (const result of results) {
      if (result.status === "rejected") {
        const typed = result.reason as { message?: string };
        console.warn(`[price-events] Failed to emit coalesced payload: ${typed?.message ?? "unknown error"}`);
      }
    }
  } finally {
    coalescerFlushing = false;

    if (pendingCoalescedByUser.size > 0 && !coalescerTimer) {
      coalescerTimer = setTimeout(() => {
        coalescerTimer = null;
        void flushQueuedCoalescedPayloads();
      }, PRICE_UPDATE_COALESCE_WINDOW_MS);
    }
  }
}

function scheduleCoalescedFlush(): void {
  if (coalescerTimer) {
    return;
  }

  coalescerTimer = setTimeout(() => {
    coalescerTimer = null;
    void flushQueuedCoalescedPayloads();
  }, PRICE_UPDATE_COALESCE_WINDOW_MS);
}

export async function flushPriceUpdateCoalescer(): Promise<void> {
  if (coalescerTimer) {
    clearTimeout(coalescerTimer);
    coalescerTimer = null;
  }

  await flushQueuedCoalescedPayloads();
}

async function emitPriceUpdatesRealtime(payloads: PriceUpdateEvent[]): Promise<void> {
  if (payloads.length === 0) {
    return;
  }

  if (PRICE_COALESCING_ENABLED) {
    for (const payload of payloads) {
      mergeCoalescedPayload(payload);
    }
    scheduleCoalescedFlush();
    return;
  }

  const results = await Promise.allSettled(payloads.map((payload) => emitPriceUpdateRealtime(payload)));
  for (const result of results) {
    if (result.status === "rejected") {
      const typed = result.reason as { message?: string };
      console.warn(`[price-events] Failed to emit realtime payload: ${typed?.message ?? "unknown error"}`);
    }
  }
}

async function processCatalogRows(batchRows: PokemonCardCatalogRow[]): Promise<ProcessPriceBatchResult> {
  if (batchRows.length === 0) {
    return {
      scannedCards: 0,
      changedCards: 0,
      emittedUsers: 0
    };
  }

  const nextPriceByPokemonCardId = await resolvePriceSource(batchRows);
  const candidates: PriceUpdateCandidate[] = [];

  for (const row of batchRows) {
    const currentPrice = Math.max(toMoneyCents(row.current_price), 1);
    const resolved = nextPriceByPokemonCardId.get(row.id);

    if (!resolved) {
      continue;
    }

    if (resolved.nextPrice !== currentPrice) {
      candidates.push({
        id: row.id,
        nextPrice: resolved.nextPrice,
        source: resolved.source
      });
    }
  }

  const updatedRows = await updateCatalogPrices(candidates);
  await Promise.all([syncPriceCache(updatedRows), scheduleNextPriceRefresh(batchRows)]);

  const ownedCardRows = await readOwnedCardsForPriceChanges(updatedRows.map((row) => row.id));
  const userPayloads = buildPriceUpdatePayloads(ownedCardRows);
  await emitPriceUpdatesRealtime(userPayloads);

  return {
    scannedCards: batchRows.length,
    changedCards: updatedRows.length,
    emittedUsers: userPayloads.length
  };
}

export async function processPriceBatchByPokemonCardIds(pokemonCardIds: string[]): Promise<ProcessPriceBatchResult> {
  const batchRows = await readCatalogRowsByIds(Array.from(new Set(pokemonCardIds)));
  return processCatalogRows(batchRows);
}

export async function pollPriceBatchLegacy(cursor: PollPriceCursor): Promise<PollPriceBatchResult> {
  const ownedQuota = Math.min(PRICE_POLLER_OWNED_PRIORITY_QUOTA, PRICE_POLLER_BATCH_SIZE);
  const ownedBatch = await readOwnedPokemonCardIdBatch(cursor.ownedCursor, ownedQuota);
  const ownedRows = await readCatalogRowsByIds(ownedBatch.pokemonCardIds);

  const catalogQuota = Math.max(PRICE_POLLER_BATCH_SIZE - ownedRows.length, 0);
  const catalogBatch = await readCatalogBatch(
    cursor.catalogCursor,
    catalogQuota,
    ownedRows.map((row) => row.id)
  );
  const batchRows = [...ownedRows, ...catalogBatch.rows];

  if (batchRows.length === 0) {
    return {
      scannedCards: 0,
      changedCards: 0,
      emittedUsers: 0,
      nextCursor: {
        catalogCursor: catalogBatch.nextCursor,
        ownedCursor: ownedBatch.nextCursor
      },
      wrapped: ownedBatch.wrapped || catalogBatch.wrapped
    };
  }

  const processed = await processCatalogRows(batchRows);

  return {
    scannedCards: processed.scannedCards,
    changedCards: processed.changedCards,
    emittedUsers: processed.emittedUsers,
    nextCursor: {
      catalogCursor: catalogBatch.nextCursor,
      ownedCursor: ownedBatch.nextCursor
    },
    wrapped: ownedBatch.wrapped || catalogBatch.wrapped
  };
}
