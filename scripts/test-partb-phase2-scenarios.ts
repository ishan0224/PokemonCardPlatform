import { randomBytes, randomUUID } from "node:crypto";
import { PACK_PRICE_CENTS } from "../src/server/config/constants";
import { withTransaction } from "../src/server/db/pool";
import { createEncryptedServerSeed } from "../src/server/services/fairness.service";
import { getLatestGenerationVersion } from "../src/server/services/pack-generation-version.service";

export type Phase2CreatedState = {
  dropIds: string[];
  dropPackIds: string[];
  packIds: string[];
  userIds: string[];
  seedIds: string[];
};

function randomClientSeedHex(): string {
  return randomBytes(16).toString("hex");
}

export function requirePhase2Env(testName: string): void {
  if (!process.env.DATABASE_URL) {
    throw new Error(`DATABASE_URL is required for ${testName}.`);
  }

  process.env.PACK_FAIRNESS_SECRET = process.env.PACK_FAIRNESS_SECRET || "test-only-phase2-fairness-secret";
}

export function createPhase2CreatedState(): Phase2CreatedState {
  return {
    dropIds: [],
    dropPackIds: [],
    packIds: [],
    userIds: [],
    seedIds: []
  };
}

export async function createTamperedCiphertextScenario(
  state: Phase2CreatedState,
  input: { userPrefix: string; emailPrefix: string }
): Promise<string> {
  return withTransaction(async (client) => {
    const generationVersion = await getLatestGenerationVersion(client);
    if (!generationVersion) {
      throw new Error("GENERATION_VERSION_MISSING: run `npm run partb:phase0:backfill` before phase2 scenario tests.");
    }
    const dropId = randomUUID();
    const dropPackId = randomUUID();
    const userId = randomUUID();
    const packId = randomUUID();
    const usernameToken = randomUUID().slice(0, 8);

    state.dropIds.push(dropId);
    state.dropPackIds.push(dropPackId);
    state.userIds.push(userId);
    state.packIds.push(packId);

    await client.query(
      `INSERT INTO users (id, username, email, balance)
       VALUES ($1, $2, $3, $4)`,
      [
        userId,
        `${input.userPrefix}_${usernameToken}`,
        `${input.emailPrefix}_${Date.now()}@test.local`,
        50_000
      ]
    );

    await client.query(
      `INSERT INTO drops (id, scheduled_at, status, active_generation_version_id)
       VALUES ($1, now(), 'completed', $2)`,
      [dropId, generationVersion.id]
    );

    await client.query(
      `INSERT INTO drop_packs (id, drop_id, tier, price, total_inventory, remaining_inventory)
       VALUES ($1, $2, 'standard', $3, 1, 0)`,
      [dropPackId, dropId, PACK_PRICE_CENTS.standard]
    );

    await client.query(
      `INSERT INTO packs (id, user_id, drop_pack_id, tier, price_paid, generation_version_id)
       VALUES ($1, $2, $3, 'standard', $4, $5)`,
      [packId, userId, dropPackId, PACK_PRICE_CENTS.standard, generationVersion.id]
    );

    const encrypted = createEncryptedServerSeed();
    const insertedSeed = await client.query<{ id: string }>(
      `INSERT INTO server_seeds (
         drop_id,
         seed_hash,
         seed_value_ciphertext,
         seed_iv,
         seed_auth_tag,
         committed_at,
         revealed_at
       )
       VALUES ($1, $2, $3, $4, $5, now(), now())
       RETURNING id`,
      [dropId, encrypted.seedHash, encrypted.ciphertext, encrypted.iv, encrypted.authTag]
    );
    const seedId = insertedSeed.rows[0].id;
    state.seedIds.push(seedId);

    await client.query(
      `INSERT INTO pack_commitments (
         pack_id,
         server_seed_id,
         server_seed_hash_at_commit,
         client_seed,
         nonce
       )
       VALUES ($1, $2, $3, $4, $5)`,
      [packId, seedId, encrypted.seedHash, randomClientSeedHex(), "1"]
    );

    await client.query(
      `UPDATE server_seeds
       SET seed_value_ciphertext = $2
       WHERE id = $1`,
      [seedId, Buffer.from([0])]
    );

    return packId;
  });
}

export async function createLegacyScenario(
  state: Phase2CreatedState,
  input: { userPrefix: string; emailPrefix: string }
): Promise<string> {
  return withTransaction(async (client) => {
    const generationVersion = await getLatestGenerationVersion(client);
    if (!generationVersion) {
      throw new Error("GENERATION_VERSION_MISSING: run `npm run partb:phase0:backfill` before phase2 scenario tests.");
    }
    const dropId = randomUUID();
    const dropPackId = randomUUID();
    const userId = randomUUID();
    const packId = randomUUID();
    const usernameToken = randomUUID().slice(0, 8);

    state.dropIds.push(dropId);
    state.dropPackIds.push(dropPackId);
    state.userIds.push(userId);
    state.packIds.push(packId);

    await client.query(
      `INSERT INTO users (id, username, email, balance)
       VALUES ($1, $2, $3, $4)`,
      [
        userId,
        `${input.userPrefix}_${usernameToken}`,
        `${input.emailPrefix}_${Date.now()}@test.local`,
        50_000
      ]
    );

    await client.query(
      `INSERT INTO drops (id, scheduled_at, status, active_generation_version_id)
       VALUES ($1, now(), 'completed', $2)`,
      [dropId, generationVersion.id]
    );

    await client.query(
      `INSERT INTO drop_packs (id, drop_id, tier, price, total_inventory, remaining_inventory)
       VALUES ($1, $2, 'standard', $3, 1, 0)`,
      [dropPackId, dropId, PACK_PRICE_CENTS.standard]
    );

    await client.query(
      `INSERT INTO packs (id, user_id, drop_pack_id, tier, price_paid, generation_version_id)
       VALUES ($1, $2, $3, 'standard', $4, $5)`,
      [packId, userId, dropPackId, PACK_PRICE_CENTS.standard, generationVersion.id]
    );

    return packId;
  });
}

export async function cleanupPhase2ScenarioState(state: Phase2CreatedState): Promise<void> {
  await withTransaction(async (client) => {
    if (state.packIds.length > 0) {
      await client.query(`DELETE FROM cards WHERE pack_id = ANY($1::uuid[])`, [state.packIds]);
      await client.query(`DELETE FROM pack_commitments WHERE pack_id = ANY($1::uuid[])`, [state.packIds]);
    }

    if (state.seedIds.length > 0) {
      await client.query(`DELETE FROM server_seed_nonce_counters WHERE server_seed_id = ANY($1::uuid[])`, [state.seedIds]);
    }

    if (state.packIds.length > 0) {
      await client.query(`DELETE FROM packs WHERE id = ANY($1::uuid[])`, [state.packIds]);
    }
    if (state.dropPackIds.length > 0) {
      await client.query(`DELETE FROM drop_packs WHERE id = ANY($1::uuid[])`, [state.dropPackIds]);
    }
    if (state.seedIds.length > 0) {
      await client.query(`DELETE FROM server_seeds WHERE id = ANY($1::uuid[])`, [state.seedIds]);
    }
    if (state.dropIds.length > 0) {
      await client.query(`DELETE FROM drops WHERE id = ANY($1::uuid[])`, [state.dropIds]);
    }
    if (state.userIds.length > 0) {
      await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [state.userIds]);
    }
  });
}
