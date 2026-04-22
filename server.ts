import { loadEnvConfig } from "@next/env";
import http from "http";
import express from "express";
import next from "next";

loadEnvConfig(process.cwd());

const port = Number(process.env.PORT ?? 3000);
const dev = process.env.NODE_ENV !== "production";

type JobStopper = () => Promise<void>;

function decodeJwtSub(accessToken: string): string | null {
  const segments = accessToken.split(".");
  if (segments.length < 2) {
    return null;
  }

  try {
    const payload = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    const paddedPayload = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
    const parsed = JSON.parse(Buffer.from(paddedPayload, "base64").toString("utf8")) as { sub?: unknown };
    return typeof parsed.sub === "string" && parsed.sub.length > 0 ? parsed.sub : null;
  } catch {
    return null;
  }
}

function readCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const token of cookieHeader.split(";")) {
    const trimmed = token.trim();
    if (!trimmed.startsWith(`${name}=`)) {
      continue;
    }
    const value = trimmed.slice(name.length + 1);
    return value.length > 0 ? decodeURIComponent(value) : null;
  }

  return null;
}

function resolveClientIp(headerValue: string | string[] | undefined, fallback: string | string[] | undefined): string {
  const forwarded = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }

  const realIp = Array.isArray(fallback) ? fallback[0] : fallback;
  return realIp?.trim() || "unknown";
}

async function bootstrap(): Promise<void> {
  const [
    { createSocketServer },
    { startAuctionCloser },
    { startDropLotteryCloser },
    { startDropScheduler },
    { startFairnessAuditor },
    { startPricePoller },
    { startPriceWorker },
    { closeDatabasePool, pingDatabase },
    { closeRedisClients, pingRedis },
    {
      PRICE_SCHEDULER_ENABLED,
      PRICE_WORKER_ENABLED,
      validateEconomicsAlertWebhookConfig,
      GLOBAL_API_RATE_LIMIT_ENABLED,
      GLOBAL_API_RATE_LIMIT_EXEMPT_PATHS
    },
    { checkGlobalRateLimit, RateLimitUnavailableError },
    { writeSecurityEventFireAndForget },
    { ACCESS_TOKEN_COOKIE },
    { flushPriceUpdateCoalescer },
    { flushAuctionsListCoalescer },
    { flushAdminMetricsCoalescer },
    { flushAuctionWatcherMetricsSamples }
  ] = await Promise.all([
    import("./src/server/websocket/index.js"),
    import("./src/server/jobs/auction-closer.js"),
    import("./src/server/jobs/drop-lottery-closer.js"),
    import("./src/server/jobs/drop-scheduler.js"),
    import("./src/server/jobs/fairness-auditor.js"),
    import("./src/server/jobs/price-poller.js"),
    import("./src/server/jobs/price-worker.js"),
    import("./src/server/db/pool.js"),
    import("./src/server/redis/client.js"),
    import("./src/server/config/constants.js"),
    import("./src/server/middleware/rate-limit.js"),
    import("./src/server/services/security-event.service.js"),
    import("./src/server/supabase/client.js"),
    import("./src/server/services/price.service.js"),
    import("./src/server/websocket/auctions-list-coalescer.js"),
    import("./src/server/websocket/admin-metrics-coalescer.js"),
    import("./src/server/services/auction-watcher-metrics.service.js")
  ]);

  const warmInfrastructure = async (): Promise<void> => {
    const [dbResult, redisResult] = await Promise.allSettled([pingDatabase(), pingRedis()]);

    if (dbResult.status === "rejected") {
      const typed = dbResult.reason as { message?: string };
      console.warn(`[startup-warmup] Database warmup skipped: ${typed?.message ?? "unknown error"}`);
    }

    if (redisResult.status === "rejected") {
      const typed = redisResult.reason as { message?: string };
      console.warn(`[startup-warmup] Redis warmup skipped: ${typed?.message ?? "unknown error"}`);
    }
  };

  const nextApp = next({ dev });
  const requestHandler = nextApp.getRequestHandler();

  validateEconomicsAlertWebhookConfig();

  await nextApp.prepare();

  const app = express();
  let lastGlobalRateLimitUnavailableLogAt = 0;

  const isGlobalApiRateLimitExemptPath = (pathname: string): boolean => {
    for (const exemptPath of GLOBAL_API_RATE_LIMIT_EXEMPT_PATHS) {
      if (pathname === exemptPath || pathname.startsWith(`${exemptPath}/`)) {
        return true;
      }
    }
    return false;
  };

  const warnGlobalRateLimitUnavailable = (reason: string): void => {
    const now = Date.now();
    if (now - lastGlobalRateLimitUnavailableLogAt < 60_000) {
      return;
    }
    lastGlobalRateLimitUnavailableLogAt = now;
    console.warn(`[global-rate-limit] unavailable; failing open (${reason}).`);
  };

  app.use(async (req, res, nextMiddleware) => {
    const pathname = req.path || "/";
    if (
      !GLOBAL_API_RATE_LIMIT_ENABLED ||
      !pathname.startsWith("/api/") ||
      isGlobalApiRateLimitExemptPath(pathname)
    ) {
      nextMiddleware();
      return;
    }

    const ip = resolveClientIp(req.headers["x-forwarded-for"], req.headers["x-real-ip"]);
    const accessToken = readCookieValue(req.headers.cookie, ACCESS_TOKEN_COOKIE);
    const userId = accessToken ? decodeJwtSub(accessToken) : null;
    const requestKey = typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : null;

    try {
      const outcome = await checkGlobalRateLimit({ ip, userId });
      if (!outcome.limited) {
        nextMiddleware();
        return;
      }

      writeSecurityEventFireAndForget({
        eventType: "rate_limit_hit",
        userId,
        ip,
        requestKey,
        evidence: {
          scope: "global",
          dimension: outcome.scope,
          path: pathname,
          retryAfterMs: outcome.retryAfterMs,
          remaining: outcome.remaining
        }
      });

      const retryAfterSeconds = Math.max(Math.ceil(outcome.retryAfterMs / 1000), 1);
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Please try again later.",
          details: {
            retryAfterMs: outcome.retryAfterMs,
            remaining: outcome.remaining,
            scope: "global",
            dimension: outcome.scope
          }
        }
      });
    } catch (error) {
      if (error instanceof RateLimitUnavailableError) {
        warnGlobalRateLimitUnavailable(error.message);
      } else {
        const typed = error as { message?: string };
        warnGlobalRateLimitUnavailable(typed.message ?? "unknown error");
      }
      nextMiddleware();
    }
  });

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.all("*", (req, res) => requestHandler(req, res));

  const httpServer = http.createServer(app);
  const io = createSocketServer(httpServer);

  await warmInfrastructure();

  const stopJobs: JobStopper[] = [
    startAuctionCloser(),
    startDropLotteryCloser(),
    startDropScheduler(),
    startFairnessAuditor()
  ];
  if (PRICE_SCHEDULER_ENABLED) {
    stopJobs.push(startPricePoller());
  }

  if (PRICE_WORKER_ENABLED) {
    stopJobs.push(startPriceWorker());
  }

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log(`Received ${signal}. Starting graceful shutdown...`);

    try {
      await Promise.allSettled(stopJobs.map((stop) => stop()));
      await flushPriceUpdateCoalescer();
      await flushAuctionsListCoalescer(io);
      await flushAdminMetricsCoalescer(io);
      await flushAuctionWatcherMetricsSamples();

      await new Promise<void>((resolve) => {
        io.close(() => resolve());
      });

      await Promise.allSettled([closeRedisClients(), closeDatabasePool()]);
      process.exit(0);
    } catch (error) {
      console.error("Error during graceful shutdown:", error);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  httpServer.listen(port, () => {
    console.log(`PullVault server listening on http://localhost:${port}`);
  });
}

void bootstrap().catch((error) => {
  console.error("Failed to bootstrap server:", error);
  process.exit(1);
});
