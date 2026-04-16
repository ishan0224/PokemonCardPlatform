import { closeDatabasePool, query } from "../src/server/db/pool";
import { closeRedisClients, pingRedis } from "../src/server/redis/client";

async function main(): Promise<void> {
  const missingEnv: string[] = [];

  if (!process.env.DATABASE_URL) {
    missingEnv.push("DATABASE_URL");
  }

  if (!process.env.REDIS_URL && !process.env.REDIS_PUB_URL && !process.env.REDIS_SUB_URL) {
    missingEnv.push("REDIS_URL (or REDIS_PUB_URL/REDIS_SUB_URL)");
  }

  if (missingEnv.length > 0) {
    throw new Error(`Missing required environment variables: ${missingEnv.join(", ")}`);
  }

  const dbResult = await query<{ ok: number }>("SELECT 1 AS ok");
  const dbOk = dbResult.rows[0]?.ok === 1;

  if (!dbOk) {
    throw new Error("Database ping failed.");
  }

  const redisResult = await pingRedis();

  if (redisResult !== "PONG") {
    throw new Error(`Redis ping failed. Expected PONG, got ${redisResult}`);
  }

  console.log("Database: OK");
  console.log("Redis: OK");
}

main()
  .catch((error) => {
    console.error("Connection verification failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([closeDatabasePool(), closeRedisClients()]);
  });
