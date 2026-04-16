import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.warn("DATABASE_URL is not configured. Database operations will fail until it is set.");
}

const sslEnabled = process.env.DATABASE_SSL === "true";

export const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
      max: 20,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000
    })
  : null;

function getPool(): Pool {
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  return pool;
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
  }
}
