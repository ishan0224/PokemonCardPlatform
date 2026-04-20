-- Seed SQL is intentionally non-authoritative.
-- Canonical seeding path:
--   1) npm run partb:phase0:backfill
--   2) npm run seed:drop
--
-- Rationale: keep pack prices/inventory and generation pinning in one SSOT path (`scripts/seed-initial-drop.ts`)
-- and avoid drift from hardcoded SQL values.

DO $$
BEGIN
  RAISE EXCEPTION
    'SEED_SQL_DISABLED: use `npm run seed:drop` (after `npm run partb:phase0:backfill`) so seeding follows runtime config SSOT.';
END $$;
