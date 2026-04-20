import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PACK_PRICE_CENTS } from "../src/server/config/constants";
import { PACK_TIER_CONFIGS } from "../src/server/config/pack-tiers";
import { closeDatabasePool, query, withTransaction } from "../src/server/db/pool";
import { closeRedisClients } from "../src/server/redis/client";
import { purchasePack } from "../src/server/services/drop.service";
import { createEncryptedServerSeed, ensureNonceCounterRow } from "../src/server/services/fairness.service";
import { ensureLatestGenerationVersion } from "../src/server/services/pack-generation-version.service";

type SmokeState = {
  dropId: string | null;
  dropPackId: string | null;
  serverSeedId: string | null;
  userIds: string[];
  cardIds: string[];
};

function requiredEnv(): void {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for test:n1:concurrency.");
  }

  process.env.PACK_FAIRNESS_SECRET = process.env.PACK_FAIRNESS_SECRET || "test-only-n1-fairness-secret";
}

async function seedCatalogCards(cardIds: string[]): Promise<void> {
  const rarityByIndex = ["common", "uncommon", "rare", "holo_rare", "ultra_rare", "chase"] as const;

  for (let index = 0; index < rarityByIndex.length; index += 1) {
    const id = randomUUID();
    cardIds.push(id);

    await query(
      `INSERT INTO pokemon_cards (
         id, tcg_id, name, set_name, set_id, rarity, rarity_tier, image_url, image_url_hires, current_price, previous_price
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, $8, $9)`,
      [
        id,
        `smoke-${Date.now()}-${index}-${randomUUID().slice(0, 8)}`,
        `Smoke Card ${index + 1}`,
        "Smoke Set",
        "smoke-set",
        rarityByIndex[index],
        rarityByIndex[index],
        100 + index,
        100 + index
      ]
    );
  }
}

async function setupSmokeState(state: SmokeState): Promise<void> {
  await seedCatalogCards(state.cardIds);

  await withTransaction(async (client) => {
    const generationVersion = await ensureLatestGenerationVersion(client);

    const dropId = randomUUID();
    const dropPackId = randomUUID();
    state.dropId = dropId;
    state.dropPackId = dropPackId;

    await client.query(
      `INSERT INTO drops (id, scheduled_at, status, active_generation_version_id)
       VALUES ($1, now(), 'active', $2)`,
      [dropId, generationVersion.id]
    );

    await client.query(
      `INSERT INTO drop_packs (id, drop_id, tier, price, total_inventory, remaining_inventory)
       VALUES ($1, $2, 'standard', $3, 2, 2)`,
      [dropPackId, dropId, PACK_PRICE_CENTS.standard]
    );

    const encryptedSeed = createEncryptedServerSeed();
    const seedResult = await client.query<{ id: string }>(
      `INSERT INTO server_seeds (
         drop_id,
         seed_hash,
         seed_value_ciphertext,
         seed_iv,
         seed_auth_tag
       )
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [dropId, encryptedSeed.seedHash, encryptedSeed.ciphertext, encryptedSeed.iv, encryptedSeed.authTag]
    );
    state.serverSeedId = seedResult.rows[0].id;
    await ensureNonceCounterRow(client, state.serverSeedId);

    for (let index = 0; index < 4; index += 1) {
      const userId = randomUUID();
      state.userIds.push(userId);
      await client.query(
        `INSERT INTO users (id, username, email, balance)
         VALUES ($1, $2, $3, $4)`,
        [userId, `smoke_user_${Date.now()}_${index}`, `smoke_${Date.now()}_${index}@test.local`, 50_000]
      );
    }
  });
}

async function cleanupSmokeState(state: SmokeState): Promise<void> {
  await withTransaction(async (client) => {
    if (state.dropPackId) {
      const packIdsResult = await client.query<{ id: string }>(
        `SELECT id
         FROM packs
         WHERE drop_pack_id = $1`,
        [state.dropPackId]
      );
      const packIds = packIdsResult.rows.map((row) => row.id);

      if (packIds.length > 0) {
        await client.query(`DELETE FROM transactions WHERE reference_id = ANY($1::uuid[])`, [packIds]);
        await client.query(`DELETE FROM platform_revenue WHERE reference_id = ANY($1::uuid[])`, [packIds]);
        await client.query(`DELETE FROM cards WHERE pack_id = ANY($1::uuid[])`, [packIds]);
        await client.query(`DELETE FROM pack_commitments WHERE pack_id = ANY($1::uuid[])`, [packIds]);
      }

      await client.query(`DELETE FROM packs WHERE drop_pack_id = $1`, [state.dropPackId]);
      await client.query(`DELETE FROM drop_packs WHERE id = $1`, [state.dropPackId]);
    }

    if (state.serverSeedId) {
      await client.query(`DELETE FROM server_seed_nonce_counters WHERE server_seed_id = $1`, [state.serverSeedId]);
    }

    if (state.dropId) {
      await client.query(`DELETE FROM server_seeds WHERE drop_id = $1`, [state.dropId]);
      await client.query(`DELETE FROM drops WHERE id = $1`, [state.dropId]);
    }

    if (state.userIds.length > 0) {
      await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [state.userIds]);
    }

    if (state.cardIds.length > 0) {
      await client.query(`DELETE FROM pokemon_cards WHERE id = ANY($1::uuid[])`, [state.cardIds]);
    }
  });
}

async function runSmoke(): Promise<void> {
  requiredEnv();
  const state: SmokeState = {
    dropId: null,
    dropPackId: null,
    serverSeedId: null,
    userIds: [],
    cardIds: []
  };

  try {
    await setupSmokeState(state);
    if (!state.dropId || !state.dropPackId) {
      throw new Error("Smoke setup failed to create drop context.");
    }

    const attempts = state.userIds.map(async (userId) => {
      try {
        const purchase = await purchasePack({
          userId,
          dropId: state.dropId as string,
          tier: "standard"
        });
        return { ok: true as const, purchase };
      } catch (error) {
        const code = (error as { code?: string })?.code ?? "UNKNOWN";
        return { ok: false as const, code };
      }
    });

    const results = await Promise.all(attempts);
    const successCount = results.filter((result) => result.ok).length;
    const soldOutLosers = results.filter((result) => !result.ok && result.code === "SOLD_OUT").length;
    const nonSoldOutLosers = results.filter((result) => !result.ok && result.code !== "SOLD_OUT");

    assert.equal(successCount, 2, "Exactly 2 purchases should succeed for inventory=2.");
    assert.equal(
      soldOutLosers,
      state.userIds.length - 2,
      "All non-winners should fail with SOLD_OUT under inventory-first rejection precedence."
    );
    assert.equal(nonSoldOutLosers.length, 0, "No loser should fail with a non-SOLD_OUT code in this contention scenario.");

    const dropPackState = await query<{ remaining_inventory: number }>(
      `SELECT remaining_inventory
       FROM drop_packs
       WHERE id = $1`,
      [state.dropPackId]
    );
    assert.equal(dropPackState.rows[0]?.remaining_inventory, 0, "Inventory must reach zero exactly.");

    const cardCount = await query<{ total: string }>(
      `SELECT COUNT(*)::BIGINT AS total
       FROM cards c
       JOIN packs p ON p.id = c.pack_id
       WHERE p.drop_pack_id = $1`,
      [state.dropPackId]
    );
    const expectedCardCount = 2 * PACK_TIER_CONFIGS.standard.cardsPerPack;
    assert.equal(
      Number(cardCount.rows[0]?.total ?? 0),
      expectedCardCount,
      `Two successful standard packs should persist ${expectedCardCount} cards.`
    );

    console.log("[test:n1:concurrency] PASS");
  } finally {
    await cleanupSmokeState(state);
  }
}

runSmoke()
  .catch((error) => {
    console.error("[test:n1:concurrency] FAIL", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([closeDatabasePool(), closeRedisClients()]);
  });
