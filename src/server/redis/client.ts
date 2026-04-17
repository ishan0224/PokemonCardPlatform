import Redis from "ioredis";
import type { PackTier } from "../../lib/types";

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetMs: number;
};

const redisBaseUrl = process.env.REDIS_URL;

if (!redisBaseUrl) {
  console.warn("REDIS_URL is not configured. Redis operations will fail until it is set.");
}

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

const pubUrl = process.env.REDIS_PUB_URL || redisBaseUrl;
const subUrl = process.env.REDIS_SUB_URL || redisBaseUrl;

const redisClient = pubUrl ? createRedisConnection(pubUrl) : null;
const redisSubscriber = subUrl ? createRedisConnection(subUrl) : null;
const redisAdapterPubClient = pubUrl ? createRedisConnection(pubUrl) : null;
const redisAdapterSubClient = subUrl ? createRedisConnection(subUrl) : null;

export function canUseRedisPubSub(): boolean {
  return Boolean(redisClient && redisSubscriber);
}

export function canUseRedisAdapterPubSub(): boolean {
  return Boolean(redisAdapterPubClient && redisAdapterSubClient);
}

export function isRedisConfigured(): boolean {
  return Boolean(redisClient);
}

export function getRedisClient(): Redis {
  if (!redisClient) {
    throw new Error("Redis client is not configured. Set REDIS_URL.");
  }

  return redisClient;
}

export function getRedisSubscriber(): Redis {
  if (!redisSubscriber) {
    throw new Error("Redis subscriber is not configured. Set REDIS_URL.");
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
  if (!redisAdapterPubClient || !redisAdapterSubClient) {
    throw new Error("Redis adapter pub/sub is not configured. Set REDIS_URL.");
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

export async function closeRedisClients(): Promise<void> {
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
}
