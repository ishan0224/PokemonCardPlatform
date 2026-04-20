import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import type { QueryResult, QueryResultRow } from "pg";

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
};

type ServerSeedRow = {
  id: string;
  seed_hash: string;
  seed_value_ciphertext: Buffer;
  seed_iv: Buffer;
  seed_auth_tag: Buffer;
};

const GCM_IV_BYTES = 12;

function getFairnessSecretBytes(): Buffer {
  const secret = process.env.PACK_FAIRNESS_SECRET;
  if (!secret) {
    throw new Error("PACK_FAIRNESS_SECRET is not configured.");
  }

  return createHash("sha256").update(secret).digest();
}

export function createEncryptedServerSeed(): {
  seedHash: string;
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  plaintextHex: string;
} {
  const key = getFairnessSecretBytes();
  const seedBytes = randomBytes(32);
  const iv = randomBytes(GCM_IV_BYTES);

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(seedBytes), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const seedHash = createHash("sha256").update(seedBytes).digest("hex");

  return {
    seedHash,
    ciphertext,
    iv,
    authTag,
    plaintextHex: seedBytes.toString("hex")
  };
}

export function decryptServerSeed(input: {
  seedValueCiphertext: Buffer;
  seedIv: Buffer;
  seedAuthTag: Buffer;
  seedHash: string;
}): string {
  const key = getFairnessSecretBytes();
  const decipher = createDecipheriv("aes-256-gcm", key, input.seedIv);
  decipher.setAuthTag(input.seedAuthTag);

  const plaintext = Buffer.concat([decipher.update(input.seedValueCiphertext), decipher.final()]);
  const computedHash = createHash("sha256").update(plaintext).digest("hex");

  if (computedHash !== input.seedHash) {
    throw new Error("Server seed hash verification failed.");
  }

  return plaintext.toString("hex");
}

export async function ensureNonceCounterRow(client: Queryable, serverSeedId: string): Promise<void> {
  await client.query(
    `INSERT INTO server_seed_nonce_counters (server_seed_id, next_nonce)
     VALUES ($1, 1)
     ON CONFLICT (server_seed_id) DO NOTHING`,
    [serverSeedId]
  );
}

export async function allocateServerSeedNonce(client: Queryable, serverSeedId: string): Promise<bigint> {
  const locked = await client.query<{ next_nonce: string }>(
    `SELECT next_nonce
     FROM server_seed_nonce_counters
     WHERE server_seed_id = $1
     FOR UPDATE`,
    [serverSeedId]
  );

  if (locked.rowCount !== 1) {
    throw new Error("Nonce counter row missing for server seed.");
  }

  const nonce = BigInt(locked.rows[0].next_nonce);

  await client.query(
    `UPDATE server_seed_nonce_counters
     SET next_nonce = next_nonce + 1
     WHERE server_seed_id = $1`,
    [serverSeedId]
  );

  return nonce;
}

export async function lockUnrevealedServerSeed(client: Queryable, dropId: string): Promise<ServerSeedRow | null> {
  const row = await client.query<ServerSeedRow>(
    `SELECT id,
            seed_hash,
            seed_value_ciphertext,
            seed_iv,
            seed_auth_tag
     FROM server_seeds
     WHERE drop_id = $1
       AND revealed_at IS NULL
     FOR UPDATE`,
    [dropId]
  );

  if (row.rowCount !== 1) {
    return null;
  }

  return row.rows[0];
}

