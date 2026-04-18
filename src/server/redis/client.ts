import Redis from "ioredis";
import type { PackTier } from "../../lib/types";

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetMs: number;
};

export type PokemonCardPriceCacheValue = {
  currentPrice: number;
  previousPrice: number;
  updatedAt: string;
};

let redisClient: Redis | null = null;
let redisSubscriber: Redis | null = null;
let redisAdapterPubClient: Redis | null = null;
let redisAdapterSubClient: Redis | null = null;
let redisInitialized = false;
let missingRedisConfigWarned = false;

function createRedisConnection(url: string): Redis {
  const client = new Redis(url, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    // Prevent eager network dials at module import time (important for build/test environments).
    lazyConnect: true
  });

  // Prevent noisy unhandled error-event warnings when Redis is unreachable.
  client.on("error", (error) => {
    console.warn(`[redis] ${error.message}`);
  });

  return client;
}

function resolveRedisUrls(): { baseUrl: string | null; pubUrl: string | null; subUrl: string | null } {
  const baseUrl = process.env.REDIS_URL ?? null;
  const pubUrl = process.env.REDIS_PUB_URL ?? baseUrl;
  const subUrl = process.env.REDIS_SUB_URL ?? baseUrl;

  return { baseUrl, pubUrl, subUrl };
}

function initializeRedisClients(): void {
  if (redisInitialized) {
    return;
  }

  redisInitialized = true;
  const { baseUrl, pubUrl, subUrl } = resolveRedisUrls();

  if (!baseUrl && !pubUrl && !subUrl && !missingRedisConfigWarned) {
    console.warn("REDIS_URL is not configured. Redis operations will fail until it is set.");
    missingRedisConfigWarned = true;
  }

  redisClient = pubUrl ? createRedisConnection(pubUrl) : null;
  redisSubscriber = subUrl ? createRedisConnection(subUrl) : null;
  redisAdapterPubClient = pubUrl ? createRedisConnection(pubUrl) : null;
  redisAdapterSubClient = subUrl ? createRedisConnection(subUrl) : null;
}

export function canUseRedisPubSub(): boolean {
  initializeRedisClients();
  return Boolean(redisClient && redisSubscriber);
}

export function canUseRedisAdapterPubSub(): boolean {
  initializeRedisClients();
  return Boolean(redisAdapterPubClient && redisAdapterSubClient);
}

export function isRedisConfigured(): boolean {
  initializeRedisClients();
  return Boolean(redisClient);
}

export function getRedisClient(): Redis {
  initializeRedisClients();
  if (!redisClient) {
    throw new Error("Redis client is not configured. Set REDIS_URL or REDIS_PUB_URL.");
  }

  return redisClient;
}

export function getRedisSubscriber(): Redis {
  initializeRedisClients();
  if (!redisSubscriber) {
    throw new Error("Redis subscriber is not configured. Set REDIS_URL or REDIS_SUB_URL.");
  }

  return redisSubscriber;
}

export function getRedisPubSubClients(): { pubClient: Redis; subClient: Redis } {
  return {
    pubClient: getRedisClient(),
    subClient: getRedisSubscriber()
  };
}

export function getRedisAdapterPubSubClients(): { pubClient: Redis; subClient: Redis } {
  initializeRedisClients();
  if (!redisAdapterPubClient || !redisAdapterSubClient) {
    throw new Error("Redis adapter pub/sub is not configured. Set REDIS_URL or REDIS_PUB_URL/REDIS_SUB_URL.");
  }

  return {
    pubClient: redisAdapterPubClient,
    subClient: redisAdapterSubClient
  };
}

export async function pingRedis(): Promise<string> {
  return getRedisClient().ping();
}

export async function publish(channel: string, payload: string): Promise<number> {
  return getRedisClient().publish(channel, payload);
}

export async function subscribe(channel: string, handler: (message: string) => void): Promise<void> {
  const subscriber = getRedisSubscriber();
  await subscriber.subscribe(channel);

  subscriber.on("message", (incomingChannel, message) => {
    if (incomingChannel === channel) {
      handler(message);
    }
  });
}

export async function slidingWindowRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = windowSeconds * 1_000;
  const windowStart = now - windowMs;
  const requestId = `${now}:${Math.random().toString(36).slice(2)}`;

  const tx = getRedisClient().multi();
  tx.zremrangebyscore(key, 0, windowStart);
  tx.zadd(key, now, requestId);
  tx.zcard(key);
  tx.pexpire(key, windowMs);

  const result = await tx.exec();

  if (!result) {
    throw new Error("Rate-limit transaction failed.");
  }

  const currentCount = Number(result[2]?.[1] ?? 0);

  return {
    allowed: currentCount <= limit,
    remaining: Math.max(limit - currentCount, 0),
    resetMs: windowMs
  };
}

function dropInventoryKey(dropId: string, tier: PackTier): string {
  return `drop:${dropId}:${tier}:remaining`;
}

function pokemonCardPriceKey(pokemonCardId: string): string {
  return `price:${pokemonCardId}`;
}

function parsePokemonCardPriceCacheValue(raw: string | null): PokemonCardPriceCacheValue | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PokemonCardPriceCacheValue>;
    const currentPrice = Number(parsed.currentPrice);
    const previousPrice = Number(parsed.previousPrice);
    const updatedAt = typeof parsed.updatedAt === "string" ? parsed.updatedAt : null;

    if (!updatedAt || !Number.isFinite(currentPrice) || !Number.isFinite(previousPrice)) {
      return null;
    }

    return {
      currentPrice: Math.max(Math.trunc(currentPrice), 0),
      previousPrice: Math.max(Math.trunc(previousPrice), 0),
      updatedAt
    };
  } catch (_error) {
    return null;
  }
}

export async function getDropInventoryCache(dropId: string, tier: PackTier): Promise<number | null> {
  if (!isRedisConfigured()) {
    return null;
  }

  const value = await getRedisClient().get(dropInventoryKey(dropId, tier));

  if (value === null) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : null;
}

export async function setDropInventoryCache(dropId: string, tier: PackTier, remaining: number): Promise<void> {
  if (!isRedisConfigured()) {
    return;
  }

  await getRedisClient().set(dropInventoryKey(dropId, tier), String(Math.max(Math.trunc(remaining), 0)));
}

export async function setPokemonCardPriceCache(
  pokemonCardId: string,
  value: PokemonCardPriceCacheValue,
  ttlSeconds: number
): Promise<void> {
  if (!isRedisConfigured()) {
    return;
  }

  const safeTtl = Math.max(Math.trunc(ttlSeconds), 1);
  await getRedisClient().set(
    pokemonCardPriceKey(pokemonCardId),
    JSON.stringify(value),
    "EX",
    safeTtl
  );
}

export async function getPokemonCardPriceCacheMany(
  pokemonCardIds: string[]
): Promise<Map<string, PokemonCardPriceCacheValue>> {
  const cache = new Map<string, PokemonCardPriceCacheValue>();
  if (!isRedisConfigured() || pokemonCardIds.length === 0) {
    return cache;
  }

  const uniqueIds = Array.from(new Set(pokemonCardIds));
  const keys = uniqueIds.map((pokemonCardId) => pokemonCardPriceKey(pokemonCardId));
  const values = await getRedisClient().mget(keys);

  for (let index = 0; index < uniqueIds.length; index += 1) {
    const parsed = parsePokemonCardPriceCacheValue(values[index] ?? null);
    if (parsed) {
      cache.set(uniqueIds[index], parsed);
    }
  }

  return cache;
}

export async function closeRedisClients(): Promise<void> {
  initializeRedisClients();
  const closeOps: Promise<unknown>[] = [];

  if (redisSubscriber) {
    closeOps.push(redisSubscriber.quit());
  }

  if (redisClient) {
    closeOps.push(redisClient.quit());
  }

  if (redisAdapterSubClient) {
    closeOps.push(redisAdapterSubClient.quit());
  }

  if (redisAdapterPubClient) {
    closeOps.push(redisAdapterPubClient.quit());
  }

  await Promise.allSettled(closeOps);

  redisClient = null;
  redisSubscriber = null;
  redisAdapterPubClient = null;
  redisAdapterSubClient = null;
  redisInitialized = false;
}
