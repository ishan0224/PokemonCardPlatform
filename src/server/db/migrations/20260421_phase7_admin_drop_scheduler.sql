ALTER TABLE drops
ADD COLUMN IF NOT EXISTS name VARCHAR(120) NOT NULL DEFAULT 'Untitled Drop';

ALTER TABLE drops
ADD COLUMN IF NOT EXISTS lottery_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE drops
ADD COLUMN IF NOT EXISTS max_packs_per_user INT NOT NULL DEFAULT 2;

ALTER TABLE drops
ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

ALTER TABLE drops
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'drops_status_check'
  ) THEN
    ALTER TABLE drops
      DROP CONSTRAINT drops_status_check;
  END IF;

  ALTER TABLE drops
    ADD CONSTRAINT drops_status_check
    CHECK (status IN ('draft', 'upcoming', 'active', 'completed', 'cancelled'));
END $$;

CREATE TABLE IF NOT EXISTS drop_tier_compositions (
    drop_id                          UUID NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
    tier                             VARCHAR(20) NOT NULL CHECK (tier IN ('standard', 'premium', 'elite')),
    set_keys_json                    JSONB NOT NULL DEFAULT '[]'::jsonb,
    included_rarities_json           JSONB NOT NULL DEFAULT '[]'::jsonb,
    explicit_include_card_ids_json   JSONB NOT NULL DEFAULT '[]'::jsonb,
    explicit_exclude_card_ids_json   JSONB NOT NULL DEFAULT '[]'::jsonb,
    eligible_counts_json             JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (drop_id, tier)
);

CREATE INDEX IF NOT EXISTS idx_drop_tier_compositions_drop_id
ON drop_tier_compositions (drop_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_drop_packs_drop_tier_unique
ON drop_packs (drop_id, tier);
