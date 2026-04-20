import { dollarsToCents } from "../src/lib/decimal";
import type { RarityTier } from "../src/lib/types";
import { computeNextPriceRefreshAt, defaultLiquidityTierForRarity } from "../src/server/config/price-liquidity";
import { closeDatabasePool, query } from "../src/server/db/pool";

const POKEMON_TCG_API_URL = process.env.POKEMON_TCG_API_URL ?? "https://api.pokemontcg.io/v2/cards";
const POKEMON_TCG_API_KEY = process.env.POKEMON_TCG_API_KEY;
const PAGE_SIZE = 250;
const MAX_PAGES = 80;
const MIN_PER_RARITY = 30;
const FETCH_TIMEOUT_MS = Number(process.env.POKEMON_TCG_FETCH_TIMEOUT_MS ?? 20_000);
const FETCH_RETRY_ATTEMPTS = Number(process.env.POKEMON_TCG_FETCH_RETRY_ATTEMPTS ?? 4);
const FETCH_RETRY_BASE_DELAY_MS = Number(process.env.POKEMON_TCG_FETCH_RETRY_BASE_DELAY_MS ?? 1_500);

const REQUIRED_RARITIES: RarityTier[] = ["common", "uncommon", "rare", "holo_rare", "ultra_rare", "chase"];

const DEFAULT_PRICE_BY_RARITY_CENTS: Record<RarityTier, number> = {
  common: 5,
  uncommon: 25,
  rare: 100,
  holo_rare: 300,
  ultra_rare: 1200,
  chase: 5000
};

type TcgApiCard = {
  id?: string;
  name?: string;
  rarity?: string;
  images?: {
    small?: string;
    large?: string;
  };
  set?: {
    id?: string;
    name?: string;
  };
  tcgplayer?: {
    prices?: Record<string, Record<string, number | null> | null>;
  };
};

type TcgApiResponse = {
  data: TcgApiCard[];
  totalCount: number;
  page: number;
  pageSize: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapRarityTier(rawRarity: string | undefined): RarityTier | null {
  if (!rawRarity) {
    return null;
  }

  const rarity = rawRarity.trim().toLowerCase();

  if (rarity.includes("uncommon")) {
    return "uncommon";
  }

  if (rarity.includes("common")) {
    return "common";
  }

  if (
    rarity.includes("secret") ||
    rarity.includes("hyper") ||
    rarity.includes("rainbow") ||
    rarity.includes("illustration rare") ||
    rarity.includes("gold") ||
    rarity.includes("alt art")
  ) {
    return "chase";
  }

  if (
    rarity.includes("ultra") ||
    rarity.includes("vstar") ||
    rarity.includes("vmax") ||
    rarity.includes("rare holo v") ||
    rarity.includes("rare holo ex") ||
    rarity.includes("rare holo gx")
  ) {
    return "ultra_rare";
  }

  if (rarity.includes("holo")) {
    return "holo_rare";
  }

  if (rarity.includes("rare")) {
    return "rare";
  }

  return null;
}

type PriceExtraction = {
  priceCents: number;
  source: "external" | "simulated";
  lastExternalPriceAt: Date | null;
};

function extractMarketPrice(card: TcgApiCard, rarityTier: RarityTier): PriceExtraction {
  const priceVariants = card.tcgplayer?.prices;

  if (priceVariants) {
    for (const variant of Object.values(priceVariants)) {
      if (!variant) {
        continue;
      }

      const candidates = [variant.market, variant.mid, variant.low, variant.directLow];

      for (const amount of candidates) {
        if (typeof amount === "number" && Number.isFinite(amount) && amount > 0) {
          return {
            priceCents: dollarsToCents(amount),
            source: "external",
            lastExternalPriceAt: new Date()
          };
        }
      }
    }
  }

  return {
    priceCents: DEFAULT_PRICE_BY_RARITY_CENTS[rarityTier],
    source: "simulated",
    lastExternalPriceAt: null
  };
}

async function fetchCardsPage(page: number): Promise<TcgApiResponse> {
  const url = new URL(POKEMON_TCG_API_URL);
  url.searchParams.set("page", String(page));
  url.searchParams.set("pageSize", String(PAGE_SIZE));
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
          `[card-seeder] fetch page ${page} attempt ${attempt}/${FETCH_RETRY_ATTEMPTS} failed with ${response.status}. Retrying in ${backoffMs}ms.`
        );
        await sleep(backoffMs);
        continue;
      }

      throw new Error(`Pokemon TCG API request failed (${response.status} ${response.statusText}).`);
    } catch (error) {
      lastError = error;
      const isFinalAttempt = attempt >= FETCH_RETRY_ATTEMPTS;
      if (isFinalAttempt) {
        break;
      }
      const backoffMs = FETCH_RETRY_BASE_DELAY_MS * attempt;
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `[card-seeder] fetch page ${page} attempt ${attempt}/${FETCH_RETRY_ATTEMPTS} failed (${reason}). Retrying in ${backoffMs}ms.`
      );
      await sleep(backoffMs);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Pokemon TCG API request failed after ${FETCH_RETRY_ATTEMPTS} attempts.`);
}

async function upsertCard(card: TcgApiCard, rarityTier: RarityTier): Promise<void> {
  const tcgId = card.id;
  const name = card.name;
  const setName = card.set?.name;

  if (!tcgId || !name || !setName) {
    return;
  }

  const rarity = card.rarity ?? "Unknown";
  const extracted = extractMarketPrice(card, rarityTier);
  const defaultLiquidityTier = defaultLiquidityTierForRarity(rarityTier);
  const nextPriceRefreshAt = computeNextPriceRefreshAt(defaultLiquidityTier);

  await query(
    `INSERT INTO pokemon_cards
       (tcg_id, name, set_name, set_id, rarity, rarity_tier, image_url, image_url_hires, current_price, previous_price, last_price_update, liquidity_tier, next_price_refresh_at, last_external_price_at, last_price_source)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, now(), $10, $11, $12, $13)
     ON CONFLICT (tcg_id)
     DO UPDATE
       SET name = EXCLUDED.name,
           set_name = EXCLUDED.set_name,
           set_id = EXCLUDED.set_id,
           rarity = EXCLUDED.rarity,
           rarity_tier = EXCLUDED.rarity_tier,
           image_url = EXCLUDED.image_url,
           image_url_hires = EXCLUDED.image_url_hires,
           previous_price = pokemon_cards.current_price,
           current_price = EXCLUDED.current_price,
           last_price_update = now(),
           liquidity_tier = COALESCE(pokemon_cards.liquidity_tier, EXCLUDED.liquidity_tier),
           next_price_refresh_at = COALESCE(pokemon_cards.next_price_refresh_at, EXCLUDED.next_price_refresh_at),
           last_external_price_at = EXCLUDED.last_external_price_at,
           last_price_source = EXCLUDED.last_price_source`,
    [
      tcgId,
      name,
      setName,
      card.set?.id ?? null,
      rarity,
      rarityTier,
      card.images?.small ?? null,
      card.images?.large ?? null,
      extracted.priceCents,
      defaultLiquidityTier,
      nextPriceRefreshAt.toISOString(),
      extracted.lastExternalPriceAt?.toISOString() ?? null,
      extracted.source
    ]
  );
}

async function getRarityCoverage(): Promise<Record<RarityTier, number>> {
  const result = await query<{ rarity_tier: RarityTier; count: string }>(
    `SELECT rarity_tier, COUNT(*)::BIGINT AS count
     FROM pokemon_cards
     GROUP BY rarity_tier`
  );

  const coverage = Object.fromEntries(REQUIRED_RARITIES.map((rarity) => [rarity, 0])) as Record<RarityTier, number>;

  for (const row of result.rows) {
    coverage[row.rarity_tier] = Number(row.count);
  }

  return coverage;
}

function hasRequiredCoverage(coverage: Record<RarityTier, number>): boolean {
  return REQUIRED_RARITIES.every((rarity) => coverage[rarity] >= MIN_PER_RARITY);
}

async function main(): Promise<void> {
  let page = 1;
  let totalCount = Number.POSITIVE_INFINITY;

  while (page <= MAX_PAGES && (page - 1) * PAGE_SIZE < totalCount) {
    const response = await fetchCardsPage(page);
    totalCount = response.totalCount;

    for (const card of response.data) {
      const rarityTier = mapRarityTier(card.rarity);

      if (!rarityTier) {
        continue;
      }

      await upsertCard(card, rarityTier);
    }

    const coverage = await getRarityCoverage();
    console.log(`[card-seeder] Page ${page} processed. Coverage: ${JSON.stringify(coverage)}`);

    if (hasRequiredCoverage(coverage)) {
      console.log("[card-seeder] Required rarity coverage reached. Stopping early.");
      break;
    }

    page += 1;
  }

  const finalCoverage = await getRarityCoverage();

  if (!hasRequiredCoverage(finalCoverage)) {
    throw new Error(
      `Seeder completed without required rarity coverage. Current coverage: ${JSON.stringify(finalCoverage)}`
    );
  }

  console.log(`[card-seeder] Completed successfully. Final coverage: ${JSON.stringify(finalCoverage)}`);
}

main()
  .catch((error) => {
    console.error("Card seeder failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabasePool();
  });
