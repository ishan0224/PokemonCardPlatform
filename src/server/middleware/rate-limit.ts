import { slidingWindowRateLimit } from "../redis/client";

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
