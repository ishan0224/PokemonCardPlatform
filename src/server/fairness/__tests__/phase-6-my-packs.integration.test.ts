import { describe, expect, it } from "vitest";
import { query } from "../../db/pool";
import { getFairnessPackView, listMyFairnessPacks } from "../../services/fairness-query.service";

const hasDatabase = Boolean(process.env.DATABASE_URL);
if (!hasDatabase) {
  console.warn("[test:phase6:my-packs:integration] SKIP: DATABASE_URL is not configured.");
}

const describeDb = hasDatabase ? describe : describe.skip;

describeDb("Phase 6 fairness my-packs integration", () => {
  it("returns statuses that match per-pack fairness verifier labels", async () => {
    const userResult = await query<{ user_id: string }>(
      `SELECT p.user_id
       FROM packs p
       ORDER BY p.purchased_at DESC
       LIMIT 1`
    );

    if (userResult.rowCount !== 1) {
      console.warn("[test:phase6:my-packs:integration] SKIP: no packs found in fixture database.");
      return;
    }

    const userId = userResult.rows[0].user_id;
    const firstPage = await listMyFairnessPacks({ userId, limit: 10 });

    if (firstPage.packs.length === 0) {
      console.warn("[test:phase6:my-packs:integration] SKIP: selected user has no packs.");
      return;
    }

    for (const pack of firstPage.packs.slice(0, 5)) {
      const detail = await getFairnessPackView(pack.id);
      expect(pack.verificationStatus).toBe(detail.verificationStatus);
    }

    if (firstPage.nextCursor) {
      const secondPage = await listMyFairnessPacks({ userId, limit: 10, cursor: firstPage.nextCursor });
      for (const pack of secondPage.packs.slice(0, 3)) {
        const detail = await getFairnessPackView(pack.id);
        expect(pack.verificationStatus).toBe(detail.verificationStatus);
      }
    }
  });
});
