-- Phase 6 fairness entrypoint index
-- Up:
CREATE INDEX IF NOT EXISTS idx_packs_user_purchased_at_desc
  ON packs (user_id, purchased_at DESC);

-- Down (manual rollback):
-- DROP INDEX IF EXISTS idx_packs_user_purchased_at_desc;
