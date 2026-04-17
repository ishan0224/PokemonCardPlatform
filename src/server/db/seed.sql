-- Phase 3 initial drop seed
-- Creates one drop scheduled 5 minutes from execution time.
-- Canonical seeding path is `npm run seed:drop` (uses constants.ts SSOT values).
-- Keep this SQL fallback in sync with PACK_PRICE_CENTS and DROP_INVENTORY_DEFAULT.

WITH seeded_drop AS (
  INSERT INTO drops (scheduled_at, status)
  VALUES (now() + INTERVAL '5 minutes', 'upcoming')
  RETURNING id
)
INSERT INTO drop_packs (drop_id, tier, price, total_inventory, remaining_inventory)
SELECT id, 'standard', 500, 10, 10 FROM seeded_drop
UNION ALL
SELECT id, 'premium', 2000, 5, 5 FROM seeded_drop
UNION ALL
SELECT id, 'elite', 5000, 3, 3 FROM seeded_drop;
