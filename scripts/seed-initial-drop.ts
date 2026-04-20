import { DROP_INVENTORY_DEFAULT, PACK_PRICE_CENTS } from "../src/server/config/constants";
import { PACK_TIERS } from "../src/server/config/pack-tiers";
import { closeDatabasePool, withTransaction } from "../src/server/db/pool";
import { getLatestGenerationVersion } from "../src/server/services/pack-generation-version.service";

async function main(): Promise<void> {
  const insertedDrop = await withTransaction(async (client) => {
    const latestGenerationVersion = await getLatestGenerationVersion(client);
    if (!latestGenerationVersion) {
      throw new Error(
        "SEED_GENERATION_VERSION_MISSING: run `npm run partb:phase0:backfill` before `npm run seed:drop`."
      );
    }

    const dropResult = await client.query<{ id: string }>(
      `INSERT INTO drops (scheduled_at, status, active_generation_version_id)
       VALUES (now() + INTERVAL '5 minutes', 'upcoming', $1)
       RETURNING id`,
      [latestGenerationVersion.id]
    );

    const dropId = dropResult.rows[0].id;

    for (const tier of PACK_TIERS) {
      const inventory = DROP_INVENTORY_DEFAULT[tier];
      const price = PACK_PRICE_CENTS[tier];

      await client.query(
        `INSERT INTO drop_packs (drop_id, tier, price, total_inventory, remaining_inventory)
         VALUES ($1, $2, $3, $4, $4)`,
        [dropId, tier, price, inventory]
      );
    }

    return dropId;
  });

  console.log(`[seed:drop] Created upcoming drop ${insertedDrop}`);
}

main()
  .catch((error) => {
    console.error("Failed to seed initial drop:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabasePool();
  });
