import { loadEnvConfig } from "@next/env";
import http from "http";
import express from "express";
import next from "next";
import { createSocketServer } from "./src/server/websocket";
import { startAuctionCloser } from "./src/server/jobs/auction-closer";
import { startDropScheduler } from "./src/server/jobs/drop-scheduler";
import { startPricePoller, type JobStopper } from "./src/server/jobs/price-poller";
import { closeDatabasePool, pingDatabase } from "./src/server/db/pool";
import { closeRedisClients, pingRedis } from "./src/server/redis/client";

loadEnvConfig(process.cwd());

const port = Number(process.env.PORT ?? 3000);
const dev = process.env.NODE_ENV !== "production";

async function warmInfrastructure(): Promise<void> {
  const [dbResult, redisResult] = await Promise.allSettled([pingDatabase(), pingRedis()]);

  if (dbResult.status === "rejected") {
    const typed = dbResult.reason as { message?: string };
    console.warn(`[startup-warmup] Database warmup skipped: ${typed?.message ?? "unknown error"}`);
  }

  if (redisResult.status === "rejected") {
    const typed = redisResult.reason as { message?: string };
    console.warn(`[startup-warmup] Redis warmup skipped: ${typed?.message ?? "unknown error"}`);
  }
}

async function bootstrap(): Promise<void> {
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

  const stopJobs: JobStopper[] = [
    startPricePoller(),
    startAuctionCloser(),
    startDropScheduler()
  ];

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log(`Received ${signal}. Starting graceful shutdown...`);

    try {
      await Promise.allSettled(stopJobs.map((stop) => stop()));

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
