-- 2026-04-23 — Allow 'custom' duration_type for auctions.
-- The application already accepts custom durations end-to-end (TS type union,
-- service layer, UI). This migration brings the DB constraint in line so the
-- INSERT path stops failing with constraint check 23514.
-- Idempotent: safe to re-apply.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'auctions'::regclass
      AND conname  = 'auctions_duration_type_check'
  ) THEN
    ALTER TABLE auctions DROP CONSTRAINT auctions_duration_type_check;
  END IF;

  ALTER TABLE auctions
    ADD CONSTRAINT auctions_duration_type_check
    CHECK (duration_type IN ('1h', '6h', '24h', 'custom'));
END $$;
