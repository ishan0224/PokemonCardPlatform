CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY,
    username        VARCHAR(32) UNIQUE NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    balance         BIGINT NOT NULL DEFAULT 25000,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Business v2 policy:
-- - New users receive $250 (25000 cents).
-- - Existing user balances are not backfilled by schema migration.
ALTER TABLE users
ALTER COLUMN balance SET DEFAULT 25000;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'user';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_role_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_role_check
      CHECK (role IN ('user', 'admin'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_role_admin
  ON users (role)
  WHERE role = 'admin';

CREATE TABLE IF NOT EXISTS drops (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(120) NOT NULL DEFAULT 'Untitled Drop',
    scheduled_at    TIMESTAMPTZ NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'upcoming', 'active', 'completed')),
    lottery_enabled BOOLEAN NOT NULL DEFAULT true,
    max_packs_per_user INT NOT NULL DEFAULT 2,
    published_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

CREATE INDEX IF NOT EXISTS idx_drops_status_scheduled ON drops (status, scheduled_at);

CREATE TABLE IF NOT EXISTS drop_packs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    drop_id             UUID NOT NULL REFERENCES drops(id),
    tier                VARCHAR(20) NOT NULL CHECK (tier IN ('standard', 'premium', 'elite')),
    price               BIGINT NOT NULL,
    total_inventory     INT NOT NULL,
    remaining_inventory INT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT remaining_non_negative CHECK (remaining_inventory >= 0)
);

ALTER TABLE drop_packs
ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'drop_packs_status_check'
  ) THEN
    ALTER TABLE drop_packs
      DROP CONSTRAINT drop_packs_status_check;
  END IF;

  ALTER TABLE drop_packs
    ADD CONSTRAINT drop_packs_status_check
    CHECK (status IN ('active', 'cancelled'));
END $$;

CREATE INDEX IF NOT EXISTS idx_drop_packs_drop_id ON drop_packs (drop_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_drop_packs_drop_tier_unique ON drop_packs (drop_id, tier);

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

CREATE TABLE IF NOT EXISTS packs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    drop_pack_id    UUID NOT NULL REFERENCES drop_packs(id),
    tier            VARCHAR(20) NOT NULL,
    price_paid      BIGINT NOT NULL,
    opened          BOOLEAN NOT NULL DEFAULT false,
    purchased_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    opened_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_packs_user_id ON packs (user_id);
CREATE INDEX IF NOT EXISTS idx_packs_user_purchased_at_desc ON packs (user_id, purchased_at DESC);

CREATE TABLE IF NOT EXISTS pack_generation_versions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_number        BIGSERIAL UNIQUE NOT NULL,
    algorithm_version     TEXT NOT NULL,
    weights_json          JSONB NOT NULL,
    eligible_card_ids_json JSONB NOT NULL,
    anchor_snapshot_json  JSONB NOT NULL,
    content_hash          CHAR(64) NOT NULL UNIQUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pack_generation_versions_version_number_desc
ON pack_generation_versions (version_number DESC);

ALTER TABLE drops
ADD COLUMN IF NOT EXISTS active_generation_version_id UUID;

ALTER TABLE packs
ADD COLUMN IF NOT EXISTS generation_version_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'drops_active_generation_version_id_fkey'
  ) THEN
    ALTER TABLE drops
      ADD CONSTRAINT drops_active_generation_version_id_fkey
      FOREIGN KEY (active_generation_version_id)
      REFERENCES pack_generation_versions(id);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'packs'
      AND column_name = 'generation_version_id'
      AND is_nullable = 'YES'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM packs
      WHERE generation_version_id IS NULL
    ) THEN
      RAISE EXCEPTION
        'PACKS_GENERATION_VERSION_BACKFILL_REQUIRED: packs.generation_version_id has NULL rows. Run `npm run partb:phase0:backfill` before schema hardening.';
    END IF;

    ALTER TABLE packs
      ALTER COLUMN generation_version_id SET NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'packs_generation_version_id_fkey'
  ) THEN
    ALTER TABLE packs
      ADD CONSTRAINT packs_generation_version_id_fkey
      FOREIGN KEY (generation_version_id)
      REFERENCES pack_generation_versions(id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS server_seeds (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    drop_id               UUID UNIQUE REFERENCES drops(id),
    seed_hash             CHAR(64) NOT NULL,
    seed_value_ciphertext BYTEA,
    seed_iv               BYTEA,
    seed_auth_tag         BYTEA,
    committed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    revealed_at           TIMESTAMPTZ,
    CHECK (
      (seed_value_ciphertext IS NULL AND seed_iv IS NULL AND seed_auth_tag IS NULL)
      OR
      (seed_value_ciphertext IS NOT NULL AND seed_iv IS NOT NULL AND seed_auth_tag IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS server_seed_nonce_counters (
    server_seed_id        UUID PRIMARY KEY REFERENCES server_seeds(id),
    next_nonce            BIGINT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pack_commitments (
    pack_id                    UUID PRIMARY KEY REFERENCES packs(id),
    server_seed_id             UUID NOT NULL REFERENCES server_seeds(id),
    server_seed_hash_at_commit CHAR(64) NOT NULL,
    client_seed                TEXT NOT NULL,
    nonce                      BIGINT NOT NULL,
    UNIQUE (server_seed_id, nonce)
);

CREATE TABLE IF NOT EXISTS security_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type      VARCHAR(32) NOT NULL,
    user_id         UUID REFERENCES users(id),
    ip              VARCHAR(64),
    request_key     TEXT,
    evidence_json   JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_events_type_created_desc
ON security_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_events_user_created_desc
ON security_events (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS fairness_audit_results (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    window_start                TIMESTAMPTZ NOT NULL,
    window_end                  TIMESTAMPTZ NOT NULL,
    observed_counts_json        JSONB NOT NULL,
    expected_counts_json        JSONB NOT NULL,
    test_statistic              NUMERIC(20,10) NOT NULL,
    degrees_of_freedom          INT NOT NULL,
    p_value                     NUMERIC(10,8) NOT NULL,
    monte_carlo_n_samples       INT,
    monte_carlo_extreme_count   INT,
    ran_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    run_source                  VARCHAR(16) NOT NULL
                                CHECK (run_source IN ('nightly', 'on_demand'))
);

CREATE INDEX IF NOT EXISTS idx_fairness_audit_results_ran_at_desc
ON fairness_audit_results (ran_at DESC);

CREATE TABLE IF NOT EXISTS pokemon_cards (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tcg_id              VARCHAR(64) UNIQUE NOT NULL,
    name                VARCHAR(255) NOT NULL,
    set_name            VARCHAR(255) NOT NULL,
    set_id              VARCHAR(64),
    rarity              VARCHAR(50) NOT NULL,
    rarity_tier         VARCHAR(20) NOT NULL
                        CHECK (rarity_tier IN ('common', 'uncommon', 'rare', 'holo_rare', 'ultra_rare', 'chase')),
    image_url           TEXT,
    image_url_hires     TEXT,
    current_price       BIGINT NOT NULL DEFAULT 0,
    previous_price      BIGINT NOT NULL DEFAULT 0,
    last_price_update   TIMESTAMPTZ,
    liquidity_tier      VARCHAR(20)
                        CHECK (liquidity_tier IN ('high', 'medium', 'low', 'illiquid')),
    next_price_refresh_at TIMESTAMPTZ,
    last_external_price_at TIMESTAMPTZ,
    last_price_source   VARCHAR(20)
                        CHECK (last_price_source IN ('external', 'simulated')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pokemon_cards
ADD COLUMN IF NOT EXISTS liquidity_tier VARCHAR(20);
ALTER TABLE pokemon_cards
ADD COLUMN IF NOT EXISTS next_price_refresh_at TIMESTAMPTZ;
ALTER TABLE pokemon_cards
ADD COLUMN IF NOT EXISTS last_external_price_at TIMESTAMPTZ;
ALTER TABLE pokemon_cards
ADD COLUMN IF NOT EXISTS last_price_source VARCHAR(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pokemon_cards_liquidity_tier_check'
  ) THEN
    ALTER TABLE pokemon_cards
      ADD CONSTRAINT pokemon_cards_liquidity_tier_check
      CHECK (liquidity_tier IN ('high', 'medium', 'low', 'illiquid'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pokemon_cards_last_price_source_check'
  ) THEN
    ALTER TABLE pokemon_cards
      ADD CONSTRAINT pokemon_cards_last_price_source_check
      CHECK (last_price_source IN ('external', 'simulated'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pokemon_cards_rarity_tier ON pokemon_cards (rarity_tier);
CREATE INDEX IF NOT EXISTS idx_pokemon_cards_tcg_id ON pokemon_cards (tcg_id);
CREATE INDEX IF NOT EXISTS idx_pokemon_cards_next_refresh_tier ON pokemon_cards (next_price_refresh_at, liquidity_tier);

CREATE TABLE IF NOT EXISTS cards (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pack_id             UUID NOT NULL REFERENCES packs(id),
    owner_id            UUID NOT NULL REFERENCES users(id),
    pokemon_card_id     UUID NOT NULL REFERENCES pokemon_cards(id),
    slot_number         INT NOT NULL CHECK (slot_number BETWEEN 1 AND 20),
    rarity_tier         VARCHAR(20) NOT NULL,
    state               VARCHAR(20) NOT NULL DEFAULT 'in_pack'
                        CHECK (state IN ('in_pack', 'owned', 'listed', 'in_auction')),
    acquisition_price   BIGINT NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cards_owner_id_state ON cards (owner_id, state);
CREATE INDEX IF NOT EXISTS idx_cards_pokemon_card_id ON cards (pokemon_card_id);
CREATE INDEX IF NOT EXISTS idx_cards_active_pokemon_card_id ON cards (pokemon_card_id) WHERE state <> 'in_pack';

CREATE TABLE IF NOT EXISTS listings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id         UUID NOT NULL REFERENCES cards(id),
    seller_id       UUID NOT NULL REFERENCES users(id),
    price           BIGINT NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'sold', 'cancelled')),
    buyer_id        UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    sold_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_listings_status ON listings (status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_listings_seller_id ON listings (seller_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_listings_card_active ON listings (card_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS auctions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id             UUID NOT NULL REFERENCES cards(id),
    seller_id           UUID NOT NULL REFERENCES users(id),
    starting_bid        BIGINT NOT NULL,
    current_bid         BIGINT,
    current_bidder_id   UUID REFERENCES users(id),
    ends_at             TIMESTAMPTZ NOT NULL,
    original_end_time   TIMESTAMPTZ NOT NULL,
    duration_type       VARCHAR(10) NOT NULL CHECK (duration_type IN ('1h', '6h', '24h')),
    status              VARCHAR(20) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'completed', 'cancelled')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auctions_status_ends ON auctions (status, ends_at) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_auctions_card_active ON auctions (card_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS bids (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id      UUID NOT NULL REFERENCES auctions(id),
    bidder_id       UUID NOT NULL REFERENCES users(id),
    amount          BIGINT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bids_auction_id ON bids (auction_id, created_at DESC);

CREATE TABLE IF NOT EXISTS auction_watcher_samples (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id      UUID NOT NULL REFERENCES auctions(id),
    observed_count  INT NOT NULL CHECK (observed_count >= 0),
    sampled_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auction_watcher_samples_sampled_at
ON auction_watcher_samples (sampled_at DESC);

CREATE INDEX IF NOT EXISTS idx_auction_watcher_samples_auction_sampled
ON auction_watcher_samples (auction_id, sampled_at DESC);

CREATE TABLE IF NOT EXISTS auction_flags (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id      UUID NOT NULL REFERENCES auctions(id),
    flag_type       VARCHAR(32) NOT NULL,
    evidence_json   JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ,
    resolved_by     UUID REFERENCES users(id),
    resolution      VARCHAR(32)
                    CHECK (resolution IN ('dismissed', 'actioned') OR resolution IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_auction_flags_unresolved_created
ON auction_flags (resolved_at, created_at)
WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_auction_flags_auction_id
ON auction_flags (auction_id);

CREATE TABLE IF NOT EXISTS balance_holds (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    auction_id      UUID NOT NULL REFERENCES auctions(id),
    amount          BIGINT NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'released', 'captured')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_balance_holds_user_active ON balance_holds (user_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_balance_holds_auction_active ON balance_holds (auction_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    type            VARCHAR(30) NOT NULL
                    CHECK (type IN ('pack_purchase', 'trade_buy', 'trade_sell', 'trade_fee',
                                    'auction_win', 'auction_sell', 'auction_fee')),
    amount          BIGINT NOT NULL,
    reference_id    UUID,
    balance_after   BIGINT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS platform_revenue (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type            VARCHAR(20) NOT NULL
                    CHECK (type IN ('pack_margin', 'trade_fee', 'auction_fee', 'platform_discount', 'manual_adjustment')),
    amount          BIGINT NOT NULL,
    reference_id    UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'platform_revenue_type_check'
  ) THEN
    ALTER TABLE platform_revenue
      DROP CONSTRAINT platform_revenue_type_check;
  END IF;

  ALTER TABLE platform_revenue
    ADD CONSTRAINT platform_revenue_type_check
    CHECK (type IN ('pack_margin', 'trade_fee', 'auction_fee', 'platform_discount', 'manual_adjustment'));
END $$;

CREATE INDEX IF NOT EXISTS idx_platform_revenue_type ON platform_revenue (type, created_at);

CREATE TABLE IF NOT EXISTS price_update_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_key         TEXT UNIQUE NOT NULL,
    status          VARCHAR(20) NOT NULL
                    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    run_at          TIMESTAMPTZ NOT NULL,
    attempts        INT NOT NULL DEFAULT 0,
    max_attempts    INT NOT NULL DEFAULT 5,
    locked_at       TIMESTAMPTZ,
    locked_by       TEXT,
    payload         JSONB NOT NULL,
    last_error      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'price_update_jobs_status_check'
  ) THEN
    ALTER TABLE price_update_jobs
      DROP CONSTRAINT price_update_jobs_status_check;
  END IF;

  ALTER TABLE price_update_jobs
    ADD CONSTRAINT price_update_jobs_status_check
    CHECK (status IN ('pending', 'running', 'completed', 'failed'));
END $$;

CREATE INDEX IF NOT EXISTS idx_price_update_jobs_ready
ON price_update_jobs (run_at)
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_price_update_jobs_running_locked_at
ON price_update_jobs (locked_at)
WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_price_update_jobs_status_run_at
ON price_update_jobs (status, run_at);
