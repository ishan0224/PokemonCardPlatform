import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

let pool: Pool | null = null;
let missingDatabaseUrlWarned = false;

function resolveDatabaseConfig(): { databaseUrl: string | null; sslEnabled: boolean } {
  return {
    databaseUrl: process.env.DATABASE_URL ?? null,
    sslEnabled: process.env.DATABASE_SSL === "true"
  };
}

function getOrCreatePool(): Pool {
  if (pool) {
    return pool;
  }

  const { databaseUrl, sslEnabled } = resolveDatabaseConfig();
  if (!databaseUrl) {
    if (!missingDatabaseUrlWarned) {
      console.warn("DATABASE_URL is not configured. Database operations will fail until it is set.");
      missingDatabaseUrlWarned = true;
    }
    throw new Error("DATABASE_URL is not configured.");
  }

  pool = new Pool({
    connectionString: databaseUrl,
    ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
    max: 20,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000
  });

  return pool;
}

function getPool(): Pool {
  return getOrCreatePool();
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params);
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function pingDatabase(): Promise<boolean> {
  const result = await query<{ ok: number }>("SELECT 1 AS ok");
  return result.rows[0]?.ok === 1;
}

export async function closeDatabasePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
