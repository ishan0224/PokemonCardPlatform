import { loadEnvConfig } from "@next/env";
import http from "http";
import express from "express";
import next from "next";

loadEnvConfig(process.cwd());

const port = Number(process.env.PORT ?? 3000);
const dev = process.env.NODE_ENV !== "production";

type JobStopper = () => Promise<void>;

async function bootstrap(): Promise<void> {
  const [
    { createSocketServer },
    { startAuctionCloser },
    { startDropLotteryCloser },
    { startDropScheduler },
    { startPricePoller },
    { startPriceWorker },
    { closeDatabasePool, pingDatabase },
    { closeRedisClients, pingRedis },
    { PRICE_SCHEDULER_ENABLED, PRICE_WORKER_ENABLED },
    { flushPriceUpdateCoalescer },
    { flushAuctionsListCoalescer }
  ] = await Promise.all([
    import("./src/server/websocket/index.js"),
    import("./src/server/jobs/auction-closer.js"),
    import("./src/server/jobs/drop-lottery-closer.js"),
    import("./src/server/jobs/drop-scheduler.js"),
    import("./src/server/jobs/price-poller.js"),
    import("./src/server/jobs/price-worker.js"),
    import("./src/server/db/pool.js"),
    import("./src/server/redis/client.js"),
    import("./src/server/config/constants.js"),
    import("./src/server/services/price.service.js"),
    import("./src/server/websocket/auctions-list-coalescer.js")
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

  await nextApp.prepare();

  const app = express();

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.all("*", (req, res) => requestHandler(req, res));

  const httpServer = http.createServer(app);
  const io = createSocketServer(httpServer);

  await warmInfrastructure();

  const stopJobs: JobStopper[] = [startAuctionCloser(), startDropLotteryCloser(), startDropScheduler()];
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
