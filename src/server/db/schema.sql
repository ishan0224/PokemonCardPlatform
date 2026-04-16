CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY,
    username        VARCHAR(32) UNIQUE NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    balance         BIGINT NOT NULL DEFAULT 10000,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS drops (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_at    TIMESTAMPTZ NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'upcoming'
                    CHECK (status IN ('upcoming', 'active', 'completed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

CREATE INDEX IF NOT EXISTS idx_drop_packs_drop_id ON drop_packs (drop_id);

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
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pokemon_cards_rarity_tier ON pokemon_cards (rarity_tier);
CREATE INDEX IF NOT EXISTS idx_pokemon_cards_tcg_id ON pokemon_cards (tcg_id);

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
                    CHECK (type IN ('pack_margin', 'trade_fee', 'auction_fee')),
    amount          BIGINT NOT NULL,
    reference_id    UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_revenue_type ON platform_revenue (type, created_at);
