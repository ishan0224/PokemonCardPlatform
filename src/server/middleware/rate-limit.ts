import { slidingWindowRateLimit } from "../redis/client";
import { GLOBAL_API_RATE_LIMIT_PER_IP, GLOBAL_API_RATE_LIMIT_PER_USER } from "../config/constants";

export class RateLimitError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details: { retryAfterMs: number; remaining: number };

  constructor(message: string, retryAfterMs: number, remaining: number) {
    super(message);
    this.statusCode = 429;
    this.code = "RATE_LIMITED";
    this.details = { retryAfterMs, remaining };
  }
}

export class RateLimitUnavailableError extends Error {
  constructor(message = "Rate limiter unavailable.") {
    super(message);
    this.name = "RateLimitUnavailableError";
  }
}

export type RateLimitOptions = {
  key: string;
  limit: number;
  windowSeconds: number;
};

export async function enforceRateLimit(options: RateLimitOptions): Promise<void> {
  const result = await slidingWindowRateLimit(options.key, options.limit, options.windowSeconds);

  if (!result.allowed) {
    throw new RateLimitError("Too many requests. Please try again later.", result.resetMs, result.remaining);
  }
}

type GlobalRateLimitScope = "ip" | "user";

export type GlobalRateLimitResult =
  | { limited: false }
  | {
      limited: true;
      scope: GlobalRateLimitScope;
      retryAfterMs: number;
      remaining: number;
    };

function buildGlobalRateLimitKey(input: {
  scope: GlobalRateLimitScope;
  id: string;
  windowSeconds: number;
  nowMs: number;
}): string {
  const bucket = Math.floor(input.nowMs / (input.windowSeconds * 1_000));
  return `api:global:${input.scope}:${input.id}:${bucket}`;
}

function isRateLimitInfraError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const typed = error as { code?: string; message?: string };
  const code = (typed.code ?? "").toUpperCase();
  if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ENOTFOUND") {
    return true;
  }

  const message = (typed.message ?? "").toLowerCase();
  return (
    message.includes("redis") ||
    message.includes("connection is closed") ||
    message.includes("max retries per request")
  );
}

async function enforceGlobalScopeLimit(input: {
  scope: GlobalRateLimitScope;
  id: string;
  limit: number;
  windowSeconds: number;
  nowMs: number;
}): Promise<GlobalRateLimitResult> {
  try {
    await enforceRateLimit({
      key: buildGlobalRateLimitKey({
        scope: input.scope,
        id: input.id,
        windowSeconds: input.windowSeconds,
        nowMs: input.nowMs
      }),
      limit: input.limit,
      windowSeconds: input.windowSeconds
    });
    return { limited: false };
  } catch (error) {
    if (error instanceof RateLimitError) {
      return {
        limited: true,
        scope: input.scope,
        retryAfterMs: error.details.retryAfterMs,
        remaining: error.details.remaining
      };
    }

    if (isRateLimitInfraError(error)) {
      throw new RateLimitUnavailableError("Redis rate limiter unavailable.");
    }

    throw error;
  }
}

export async function checkGlobalRateLimit(input: {
  ip: string;
  userId?: string | null;
  nowMs?: number;
}): Promise<GlobalRateLimitResult> {
  const nowMs = input.nowMs ?? Date.now();

  const ipResult = await enforceGlobalScopeLimit({
    scope: "ip",
    id: input.ip,
    limit: GLOBAL_API_RATE_LIMIT_PER_IP.limit,
    windowSeconds: GLOBAL_API_RATE_LIMIT_PER_IP.windowSeconds,
    nowMs
  });
  if (ipResult.limited) {
    return ipResult;
  }

  if (input.userId) {
    const userResult = await enforceGlobalScopeLimit({
      scope: "user",
      id: input.userId,
      limit: GLOBAL_API_RATE_LIMIT_PER_USER.limit,
      windowSeconds: GLOBAL_API_RATE_LIMIT_PER_USER.windowSeconds,
      nowMs
    });
    if (userResult.limited) {
      return userResult;
    }
  }

  return { limited: false };
}
